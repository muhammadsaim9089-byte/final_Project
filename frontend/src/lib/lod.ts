/**
 * Semantic zoom (level of detail) for table cards. Below 35 % zoom a column row is 3–4 px tall — unreadable, and
 * hundreds of them cost real rendering time — so a card shows only what can be read at that size:
 *
 *   overview  zoom < 0.35         name, icon and column count, in type large enough to read zoomed out
 *   keys      0.35 ≤ zoom < 0.70  primary and foreign keys only (+ "N more columns")
 *   full      zoom ≥ 0.70         everything
 *
 * It caps the user's own "Detail level" (all / keys / headers) and never raises it. The card keeps its size at every
 * level — only its content changes — so group frames, relationship lines and the layout do not move as you zoom.
 */
export type ZoomLod = "overview" | "keys" | "full";
export type CardDetail = "overview" | "headers" | "keys" | "all";

export const LOD_OVERVIEW_BELOW = 0.35;
export const LOD_KEYS_BELOW = 0.7;

export function lodForZoom(zoom: number): ZoomLod {
  if (zoom < LOD_OVERVIEW_BELOW) return "overview";
  if (zoom < LOD_KEYS_BELOW) return "keys";
  return "full";
}

const RANK: Record<CardDetail, number> = { overview: 0, headers: 1, keys: 2, all: 3 };
const CAP: Record<ZoomLod, CardDetail> = { overview: "overview", keys: "keys", full: "all" };

/** What a card shows: the user's level for this card (a collapsed card counts as "headers"), capped by the zoom. */
export function cardDetail(userLevel: Exclude<CardDetail, "overview">, lod: ZoomLod): CardDetail {
  const cap = CAP[lod];
  return RANK[cap] < RANK[userLevel] ? cap : userLevel;
}
