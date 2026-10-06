/**
 * Share links that need no account and no server (dbdiagram "DBML-in-Link").
 *
 *   #c=<urlencoded base64 DBML>            plain            (compatible with dbdiagram.io/embed#c=…)
 *   #c=<urlencoded "pako:" + base64 zlib>  compressed       (same format dbdiagram's own share links use)
 *   #e=<base64 [v|salt|iv|ciphertext]>     password-protected (PBKDF2 → AES-GCM, decrypted in the browser)
 *   &l=<pako:…>   optional table positions   &t=<title>   &theme=dark|light
 *
 * The DBML lives in the URL fragment, so it is never sent to any server.
 */

export type ShareTheme = "light" | "dark";
export type LayoutMap = Record<string, [number, number]>;

export interface SharePayload {
  dbml: string;
  layout?: LayoutMap;
  title?: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/").replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  writer.write(bytes as unknown as BufferSource);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** zlib "deflate" — identical to pako.deflate(), so dbdiagram's embed page can read it. */
export const deflate = (bytes: Uint8Array) => pipe(bytes, new CompressionStream("deflate"));
export const inflate = (bytes: Uint8Array) => pipe(bytes, new DecompressionStream("deflate"));

export async function encodeText(text: string, compress: boolean): Promise<string> {
  if (compress) return encodeURIComponent("pako:" + bytesToBase64(await deflate(enc.encode(text))));
  return encodeURIComponent(bytesToBase64(enc.encode(text)));
}

export async function decodeText(value: string): Promise<string> {
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    /* already decoded */
  }
  if (v.startsWith("pako:")) return dec.decode(await inflate(base64ToBytes(v.slice(5))));
  return dec.decode(base64ToBytes(v));
}

// ───────────────────────────── encryption ─────────────────────────────

const ITERATIONS = 150_000;

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password) as unknown as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptText(text: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const packed = await deflate(enc.encode(text));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, packed as unknown as BufferSource));
  const out = new Uint8Array(1 + 16 + 12 + cipher.length);
  out[0] = 1;
  out.set(salt, 1);
  out.set(iv, 17);
  out.set(cipher, 29);
  return encodeURIComponent(bytesToBase64(out));
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password");
  }
}

export async function decryptText(value: string, password: string): Promise<string> {
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    /* ignore */
  }
  const bytes = base64ToBytes(v);
  if (bytes[0] !== 1) throw new Error("Unsupported share format");
  const salt = bytes.subarray(1, 17);
  const iv = bytes.subarray(17, 29);
  const cipher = bytes.subarray(29);
  const key = await deriveKey(password, salt);
  try {
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, cipher as unknown as BufferSource));
    return dec.decode(await inflate(plain));
  } catch {
    throw new WrongPasswordError();
  }
}

// ───────────────────────────── fragments ─────────────────────────────

export interface FragmentOptions {
  theme?: ShareTheme;
  compress?: boolean;
  /** When set, the payload is AES-GCM encrypted with this password. */
  password?: string;
}

export async function buildFragment(payload: SharePayload, opts: FragmentOptions = {}): Promise<string> {
  const parts: string[] = [];
  if (opts.password) {
    parts.push("e=" + (await encryptText(JSON.stringify(payload), opts.password)));
  } else {
    parts.push("c=" + (await encodeText(payload.dbml, opts.compress !== false)));
    if (payload.layout && Object.keys(payload.layout).length) parts.push("l=" + (await encodeText(JSON.stringify(payload.layout), true)));
    if (payload.title) parts.push("t=" + encodeURIComponent(payload.title));
  }
  if (opts.theme === "dark") parts.push("theme=dark");
  return parts.join("&");
}

export interface ParsedFragment {
  c?: string;
  l?: string;
  e?: string;
  t?: string;
  theme: ShareTheme;
}

export function parseFragment(hash: string): ParsedFragment {
  const raw = hash.replace(/^#/, "");
  const map = new Map<string, string>();
  for (const seg of raw.split("&")) {
    const i = seg.indexOf("=");
    if (i > 0) map.set(seg.slice(0, i), seg.slice(i + 1));
  }
  let title: string | undefined;
  const t = map.get("t");
  if (t) {
    try {
      title = decodeURIComponent(t);
    } catch {
      title = t;
    }
  }
  return { c: map.get("c"), l: map.get("l"), e: map.get("e"), t: title, theme: map.get("theme") === "dark" ? "dark" : "light" };
}

export type ResolvedShare =
  | { status: "ok"; payload: SharePayload; theme: ShareTheme }
  | { status: "needs-password"; theme: ShareTheme }
  | { status: "empty"; theme: ShareTheme }
  | { status: "error"; message: string; theme: ShareTheme };

export async function resolveFragment(hash: string, password?: string): Promise<ResolvedShare> {
  const f = parseFragment(hash);
  try {
    if (f.e) {
      if (!password) return { status: "needs-password", theme: f.theme };
      const json = await decryptText(f.e, password);
      return { status: "ok", payload: JSON.parse(json) as SharePayload, theme: f.theme };
    }
    if (f.c) {
      const dbml = await decodeText(f.c);
      let layout: LayoutMap | undefined;
      if (f.l) {
        try {
          layout = JSON.parse(await decodeText(f.l));
        } catch {
          layout = undefined;
        }
      }
      return { status: "ok", payload: { dbml, layout, title: f.t }, theme: f.theme };
    }
    return { status: "empty", theme: f.theme };
  } catch (e: any) {
    if (e instanceof WrongPasswordError) return { status: "error", message: "Wrong password", theme: f.theme };
    return { status: "error", message: e?.message || "This link is damaged", theme: f.theme };
  }
}

export function embedSnippet(url: string, opts: { height?: number; width?: string; title?: string } = {}): string {
  return `<iframe src="${url}" width="${opts.width || "100%"}" height="${opts.height || 600}" style="border:0;border-radius:8px" loading="lazy" allowfullscreen title="${(opts.title || "Database diagram").replace(/"/g, "&quot;")}"></iframe>`;
}
