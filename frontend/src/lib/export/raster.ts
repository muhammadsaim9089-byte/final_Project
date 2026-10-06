/**
 * Browser-side rasterisation: SVG → PNG / JPEG, and a dependency-free single-page PDF writer.
 */

const MAX_DIM = 8192;

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not rasterise the diagram"));
    // data: URL keeps the SVG same-origin so the canvas stays untainted
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

export async function svgToCanvas(svg: string, width: number, height: number, scale = 2, background?: string): Promise<HTMLCanvasElement> {
  const img = await svgToImage(svg);
  let s = scale;
  if (width * s > MAX_DIM || height * s > MAX_DIM) s = Math.min(MAX_DIM / width, MAX_DIM / height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * s));
  canvas.height = Math.max(1, Math.round(height * s));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))), type, quality);
  });
}

export async function svgToPngBlob(svg: string, width: number, height: number, scale = 2, background?: string): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, height, scale, background);
  return canvasToBlob(canvas, "image/png");
}

// ───────────────────────────── PDF ─────────────────────────────

const enc = new TextEncoder();

/** Builds a one-page PDF that embeds a JPEG. Page size is in PDF points (1/72 in). */
export function pdfFromJpeg(jpeg: Uint8Array, imgW: number, imgH: number, pageW: number, pageH: number, title = "DesignDB diagram"): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body);
    else body();
    push("\nendobj\n");
  };
  const f = (n: number) => String(parseFloat(n.toFixed(2)));
  const safeTitle = title.replace(/[()\\]/g, " ");

  push("%PDF-1.4\n%âãÏÓ\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pageW)} ${f(pageH)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`);
  const content = `q\n${f(pageW)} 0 0 ${f(pageH)} 0 0 cm\n/Im0 Do\nQ`;
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(5, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream");
  });
  obj(6, `<< /Title (${safeTitle}) /Producer (DesignDB) >>`);
  const xref = length;
  push(`xref\n0 7\n0000000000 65535 f \n`);
  for (let i = 1; i <= 6; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function svgToPdfBlob(svg: string, width: number, height: number, title?: string): Promise<Blob> {
  const canvas = await svgToCanvas(svg, width, height, 2, "#ffffff");
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.93);
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  // 0.75 pt per CSS px keeps the page at its natural on-screen size
  const pdf = pdfFromJpeg(jpeg, canvas.width, canvas.height, width * 0.75, height * 0.75, title);
  return new Blob([pdf as BlobPart], { type: "application/pdf" });
}

// ───────────────────────────── download helpers ─────────────────────────────

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 800);
}

export function downloadText(text: string, filename: string, mime = "text/plain") {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), filename);
}

export function safeFilename(name: string, ext: string): string {
  const base = (name || "diagram").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "diagram";
  return `${base}.${ext}`;
}
