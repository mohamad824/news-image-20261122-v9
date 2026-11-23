// news-image-20261122 v9 — "Sunday 22 November 2026" front page.
// One-page broadsheet: 36 full-day stories, top-2-style structure, warm
// amber/terracotta/olive palette on cream, olive-sepia world map.
// Pure Node 22 stdlib: own TrueType parser + glyph rasterizer, own PNG
// encoder. No network, no dependencies, deterministic output.
//
// Renders at 2x supersampling into an RGB buffer, then box-downsamples to
// 1024x1024. All text comes from real Liberation Serif TTF files in fonts/
// (SIL OFL 1.1) — no hand-drawn glyphs, no pixel font.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1024;
const H = 1024;
const SS = 2; // supersample factor
const W2 = W * SS;
const H2 = H * SS;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const CREAM: RGB = [246, 238, 216]; // #F6EED8 page
const CREAM2: RGB = [238, 228, 196]; // slightly deeper cream
const INK: RGB = [22, 18, 14];
const INK_SOFT: RGB = [74, 66, 56];
const NAVY: RGB = [31, 42, 68];
const NAVY_DARK: RGB = [26, 34, 56];
const RED: RGB = [166, 58, 46]; // newspaper red / terracotta red
const RED_DARK: RGB = [139, 44, 34];
const AMBER: RGB = [214, 138, 32];
const GOLD: RGB = [201, 154, 52];
const OLIVE: RGB = [107, 122, 58];
const OLIVE_DARK: RGB = [88, 99, 45];
const GREEN: RGB = [46, 125, 91];
const TEAL: RGB = [46, 90, 136];
const BROWN: RGB = [122, 90, 46];
const CHARCOAL: RGB = [38, 34, 28]; // warm dark for numbers column
const WHITE: RGB = [255, 252, 244];
const PAPER_LINE: RGB = [196, 178, 140];
const MAP_BG: RGB = [234, 223, 192]; // warm parchment ocean (NOT blue)
const MAP_LAND: RGB = [126, 124, 70]; // olive-sepia land (NOT blue)
const MAP_LAND_LINE: RGB = [92, 90, 48];

// ---------------------------------------------------------------- CRC32
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
const buf = new Uint8Array(W2 * H2 * 3);
function fillAll(c: RGB): void {
  for (let i = 0; i < W2 * H2; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}
// current clip rect in logical coords
let clipX0 = 0;
let clipY0 = 0;
let clipX1 = W;
let clipY1 = H;
function setClip(x: number, y: number, w: number, h: number): void {
  clipX0 = Math.max(0, x);
  clipY0 = Math.max(0, y);
  clipX1 = Math.min(W, x + w);
  clipY1 = Math.min(H, y + h);
}
function clearClip(): void {
  clipX0 = 0;
  clipY0 = 0;
  clipX1 = W;
  clipY1 = H;
}
function blend(px: number, c: RGB, a: number): void {
  // a in 0..255 coverage; px = index into buf (pixel number)
  const o = px * 3;
  const inv = 255 - a;
  buf[o] = (c[0] * a + buf[o] * inv) / 255;
  buf[o + 1] = (c[1] * a + buf[o + 1] * inv) / 255;
  buf[o + 2] = (c[2] * a + buf[o + 2] * inv) / 255;
}
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(clipX0 * SS, Math.round(x * SS));
  const y0 = Math.max(clipY0 * SS, Math.round(y * SS));
  const x1 = Math.min(clipX1 * SS, Math.round((x + w) * SS));
  const y1 = Math.min(clipY1 * SS, Math.round((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) {
    const base = yy * W2;
    for (let xx = x0; xx < x1; xx++) {
      const o = (base + xx) * 3;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    }
  }
}
function hline(x0: number, x1: number, y: number, c: RGB): void {
  rect(Math.min(x0, x1), y, Math.abs(x1 - x0), 1 / SS, c);
}
function circle(cx: number, cy: number, r: number, c: RGB): void {
  const R = r * SS;
  const CX = cx * SS;
  const CY = cy * SS;
  const y0 = Math.max(Math.ceil(CY - R), clipY0 * SS);
  const y1 = Math.min(Math.floor(CY + R), clipY1 * SS - 1);
  for (let yy = y0; yy <= y1; yy++) {
    const dy = yy + 0.5 - CY;
    const dx = Math.sqrt(Math.max(0, R * R - dy * dy));
    const xa = Math.max(Math.ceil(CX - dx), clipX0 * SS);
    const xb = Math.min(Math.floor(CX + dx), clipX1 * SS - 1);
    const base = yy * W2;
    for (let xx = xa; xx <= xb; xx++) {
      const o = (base + xx) * 3;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    }
  }
}
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const RX = rx * SS;
  const RY = ry * SS;
  const CX = cx * SS;
  const CY = cy * SS;
  const y0 = Math.max(Math.ceil(CY - RY), clipY0 * SS);
  const y1 = Math.min(Math.floor(CY + RY), clipY1 * SS - 1);
  for (let yy = y0; yy <= y1; yy++) {
    const dy = (yy + 0.5 - CY) / RY;
    const dx = RX * Math.sqrt(Math.max(0, 1 - dy * dy));
    const xa = Math.max(Math.ceil(CX - dx), clipX0 * SS);
    const xb = Math.min(Math.floor(CX + dx), clipX1 * SS - 1);
    const base = yy * W2;
    for (let xx = xa; xx <= xb; xx++) {
      const o = (base + xx) * 3;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    }
  }
}
// Non-zero winding scanline fill of a polygon (logical coords).
function poly(pts: [number, number][], c: RGB): void {
  if (pts.length < 3) return;
  const P = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of P) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const y0 = Math.max(Math.ceil(minY), clipY0 * SS);
  const y1 = Math.min(Math.floor(maxY), clipY1 * SS - 1);
  const n = P.length;
  for (let yy = y0; yy <= y1; yy++) {
    const yc = yy + 0.5;
    const xs: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const [x0, y0p] = P[i];
      const [x1, y1p] = P[(i + 1) % n];
      if ((y0p <= yc && yc < y1p) || (y1p <= yc && yc < y0p)) {
        const x = x0 + ((yc - y0p) * (x1 - x0)) / (y1p - y0p);
        xs.push([x, y1p > y0p ? 1 : -1]);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let winding = 0;
    for (let i = 0; i + 1 < xs.length; i++) {
      winding += xs[i][1];
      if (winding !== 0) {
        const xa = Math.max(Math.ceil(xs[i][0]), clipX0 * SS);
        const xb = Math.min(Math.floor(xs[i + 1][0]), clipX1 * SS - 1);
        const base = yy * W2;
        for (let xx = xa; xx <= xb; xx++) {
          const o = (base + xx) * 3;
          buf[o] = c[0];
          buf[o + 1] = c[1];
          buf[o + 2] = c[2];
        }
      }
    }
  }
}
function rrect(x: number, y: number, w: number, h: number, r: number, c: RGB): void {
  const rr = Math.min(r, w / 2, h / 2);
  rect(x + rr, y, w - 2 * rr, h, c);
  rect(x, y + rr, w, h - 2 * rr, c);
  circle(x + rr, y + rr, rr, c);
  circle(x + w - rr, y + rr, rr, c);
  circle(x + rr, y + h - rr, rr, c);
  circle(x + w - rr, y + h - rr, rr, c);
}
// Thick line as a polygon.
function line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    circle(x0, y0, w / 2, c);
    return;
  }
  const nx = (-dy / len) * (w / 2);
  const ny = (dx / len) * (w / 2);
  poly(
    [
      [x0 + nx, y0 + ny],
      [x1 + nx, y1 + ny],
      [x1 - nx, y1 - ny],
      [x0 - nx, y0 - ny],
    ],
    c,
  );
  circle(x0, y0, w / 2, c);
  circle(x1, y1, w / 2, c);
}

// ---------------------------------------------------------------- TrueType
interface Pt {
  x: number;
  y: number;
  on: boolean;
}
class Font {
  upem = 2048;
  numGlyphs = 0;
  private cmap = new Map<number, number>();
  private advances: number[] = [];
  private loca: number[] = [];
  private glyf: Buffer = Buffer.alloc(0);
  private indexToLocFormat = 0;
  private glyphCache = new Map<string, GlyphBitmap>();
  private data: Buffer;
  constructor(data: Buffer) {
    this.data = data;
    this.parse();
  }
  private u16(o: number): number {
    return this.data.readUInt16BE(o);
  }
  private i16(o: number): number {
    return this.data.readInt16BE(o);
  }
  private u32(o: number): number {
    return this.data.readUInt32BE(o);
  }
  private parse(): void {
    const numTables = this.u16(4);
    const tables = new Map<string, number>();
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = this.data.toString("ascii", o, o + 4);
      tables.set(tag, this.u32(o + 8));
    }
    const head = tables.get("head")!;
    this.upem = this.u16(head + 18);
    this.indexToLocFormat = this.i16(head + 50);
    const maxp = tables.get("maxp")!;
    this.numGlyphs = this.u16(maxp + 4);
    const hhea = tables.get("hhea")!;
    const numHMetrics = this.u16(hhea + 34);
    const hmtx = tables.get("hmtx")!;
    for (let i = 0; i < this.numGlyphs; i++) {
      const idx = Math.min(i, numHMetrics - 1);
      this.advances[i] = this.u16(hmtx + idx * 4);
    }
    // cmap: prefer format 12, else format 4
    const cmapOff = tables.get("cmap")!;
    const numSub = this.u16(cmapOff + 2);
    let fmt4 = -1;
    let fmt12 = -1;
    for (let i = 0; i < numSub; i++) {
      const o = cmapOff + 4 + i * 8;
      const sub = cmapOff + this.u32(o + 4);
      const fmt = this.u16(sub);
      if (fmt === 12) fmt12 = sub;
      else if (fmt === 4) fmt4 = sub;
    }
    if (fmt12 >= 0) {
      const nGroups = this.u32(fmt12 + 12);
      for (let g = 0; g < nGroups; g++) {
        const o = fmt12 + 16 + g * 12;
        const start = this.u32(o);
        const end = this.u32(o + 4);
        const gid0 = this.u32(o + 8);
        for (let cp = start; cp <= end; cp++) this.cmap.set(cp, gid0 + (cp - start));
      }
    } else if (fmt4 >= 0) {
      const segCount = this.u16(fmt4 + 6) / 2;
      const endOff = fmt4 + 14;
      const startOff = endOff + segCount * 2 + 2;
      const deltaOff = startOff + segCount * 2;
      const rangeOff = deltaOff + segCount * 2;
      for (let s = 0; s < segCount; s++) {
        const end = this.u16(endOff + s * 2);
        const start = this.u16(startOff + s * 2);
        const delta = this.i16(deltaOff + s * 2);
        const range = this.u16(rangeOff + s * 2);
        for (let cp = start; cp <= end; cp++) {
          if (cp === 0xffff) break;
          let gid: number;
          if (range === 0) gid = (cp + delta) & 0xffff;
          else {
            const ro = rangeOff + s * 2 + range + (cp - start) * 2;
            gid = this.u16(ro);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid !== 0) this.cmap.set(cp, gid);
        }
      }
    }
    const locaOff = tables.get("loca")!;
    this.glyf = this.data.subarray(tables.get("glyf")!);
    for (let i = 0; i <= this.numGlyphs; i++) {
      this.loca[i] =
        this.indexToLocFormat === 1 ? this.u32(locaOff + i * 4) : this.u16(locaOff + i * 2) * 2;
    }
  }
  glyphId(code: number): number {
    return this.cmap.get(code) ?? 0;
  }
  advance(code: number): number {
    const gid = this.glyphId(code);
    return (this.advances[gid] ?? this.advances[0] ?? 0) / this.upem;
  }
  measure(text: string, size: number): number {
    let w = 0;
    for (const ch of text) w += this.advance(ch.codePointAt(0)!) * size;
    return w;
  }
  // Outline contours of a glyph, in font units (y up).
  private outline(gid: number): Pt[][] {
    if (gid >= this.numGlyphs) return [];
    const start = this.loca[gid];
    const end = this.loca[gid + 1];
    if (end <= start) return [];
    const g = this.glyf.subarray(start, end);
    const numContours = g.readInt16BE(0);
    if (numContours < 0) return this.composite(g);
    if (numContours === 0) return [];
    let p = 10;
    const endPts: number[] = [];
    for (let i = 0; i < numContours; i++) endPts.push(g.readUInt16BE(p + i * 2));
    p += numContours * 2 + 2; // skip instruction length + instructions
    const instrLen = g.readUInt16BE(p - 2);
    p += instrLen;
    const totalPts = endPts[endPts.length - 1] + 1;
    const flags: number[] = [];
    while (flags.length < totalPts) {
      const f = g[p++];
      flags.push(f);
      if (f & 0x08) {
        const rep = g[p++];
        for (let i = 0; i < rep; i++) flags.push(f);
      }
    }
    const xs: number[] = [];
    let x = 0;
    for (let i = 0; i < totalPts; i++) {
      const f = flags[i];
      if (f & 0x02) {
        const dx = g[p++];
        x += f & 0x10 ? dx : -dx;
      } else if (!(f & 0x10)) {
        x += g.readInt16BE(p);
        p += 2;
      }
      xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (let i = 0; i < totalPts; i++) {
      const f = flags[i];
      if (f & 0x04) {
        const dy = g[p++];
        y += f & 0x20 ? dy : -dy;
      } else if (!(f & 0x20)) {
        y += g.readInt16BE(p);
        p += 2;
      }
      ys.push(y);
    }
    const contours: Pt[][] = [];
    let first = 0;
    for (const ep of endPts) {
      const c: Pt[] = [];
      for (let i = first; i <= ep; i++) c.push({ x: xs[i], y: ys[i], on: (flags[i] & 0x01) !== 0 });
      contours.push(c);
      first = ep + 1;
    }
    return contours;
  }
  private composite(g: Buffer): Pt[][] {
    let p = 10;
    const out: Pt[][] = [];
    for (;;) {
      const flags = g.readUInt16BE(p);
      const gid = g.readUInt16BE(p + 2);
      p += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 0x0001) {
        dx = g.readInt16BE(p);
        dy = g.readInt16BE(p + 2);
        p += 4;
      } else {
        dx = g.readInt8(p);
        dy = g.readInt8(p + 1);
        p += 2;
      }
      // transform: a b / c d (default identity)
      let a = 1;
      let b = 0;
      let cc = 0;
      let d = 1;
      if (flags & 0x0008) {
        const s = g.readInt16BE(p) / 16384;
        a = s;
        d = s;
        p += 2;
      } else if (flags & 0x0080) {
        a = g.readInt16BE(p) / 16384;
        d = g.readInt16BE(p + 2) / 16384;
        p += 4;
      } else if (flags & 0x0040) {
        a = g.readInt16BE(p) / 16384;
        b = g.readInt16BE(p + 2) / 16384;
        cc = g.readInt16BE(p + 4) / 16384;
        d = g.readInt16BE(p + 6) / 16384;
        p += 8;
      }
      for (const contour of this.outline(gid)) {
        out.push(contour.map((pt) => ({ x: a * pt.x + b * pt.y + dx, y: cc * pt.x + d * pt.y + dy, on: pt.on })));
      }
      if (!(flags & 0x0020)) break;
    }
    return out;
  }
  // Flatten a contour to line segments (font units, y up).
  private flatten(contour: Pt[], scale: number): [number, number][][] {
    const pts = contour;
    const n = pts.length;
    if (n === 0) return [];
    // find start point
    let start: Pt;
    let startIdx = 0;
    if (pts[0].on) {
      start = pts[0];
      startIdx = 1;
    } else if (pts[n - 1].on) {
      start = pts[n - 1];
      startIdx = 0;
    } else {
      start = { x: (pts[0].x + pts[n - 1].x) / 2, y: (pts[0].y + pts[n - 1].y) / 2, on: true };
      startIdx = 0;
    }
    const segs: [number, number][][] = [];
    let cur: [number, number] = [start.x * scale, start.y * scale];
    const order: Pt[] = [];
    for (let i = 0; i < n; i++) order.push(pts[(startIdx + i) % n]);
    // walk
    let i = 0;
    while (i < order.length) {
      const pt = order[i];
      if (pt.on) {
        const nx: [number, number] = [pt.x * scale, pt.y * scale];
        segs.push([cur, nx]);
        cur = nx;
        i++;
      } else {
        const next = order[(i + 1) % order.length];
        let cx = pt.x;
        let cy = pt.y;
        let ex: number;
        let ey: number;
        if (next.on) {
          ex = next.x;
          ey = next.y;
          i += 2;
        } else {
          ex = (pt.x + next.x) / 2;
          ey = (pt.y + next.y) / 2;
          i += 1;
        }
        // quadratic from cur to (ex,ey) with control (cx,cy)
        const x0 = cur[0];
        const y0 = cur[1];
        const x1 = cx * scale;
        const y1 = cy * scale;
        const x2 = ex * scale;
        const y2 = ey * scale;
        const dist = Math.hypot(x2 - x0, y2 - y0) + Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.max(3, Math.min(24, Math.ceil(dist / (4 * scale * 0.02 + 2))));
        let prev: [number, number] = cur;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const mt = 1 - t;
          const px = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
          const py = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
          const np: [number, number] = [px, py];
          segs.push([prev, np]);
          prev = np;
        }
        cur = prev;
      }
    }
    // close contour
    if (Math.abs(cur[0] - start.x * scale) > 0.01 || Math.abs(cur[1] - start.y * scale) > 0.01) {
      segs.push([cur, [start.x * scale, start.y * scale]]);
    }
    return segs;
  }
  rasterize(code: number, pxSize: number): GlyphBitmap {
    const key = `${code}@${pxSize}`;
    const hit = this.glyphCache.get(key);
    if (hit) return hit;
    const gid = this.glyphId(code);
    const scale = pxSize / this.upem;
    const contours = this.outline(gid);
    // bounds
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const allSegs: [number, number][][] = [];
    for (const c of contours) {
      const segs = this.flatten(c, scale);
      for (const [a, b] of segs) {
        allSegs.push([a, b]);
        minX = Math.min(minX, a[0], b[0]);
        maxX = Math.max(maxX, a[0], b[0]);
        minY = Math.min(minY, a[1], b[1]);
        maxY = Math.max(maxY, a[1], b[1]);
      }
    }
    const adv = (this.advances[gid] ?? 0) * scale;
    if (allSegs.length === 0 || !isFinite(minX)) {
      const empty: GlyphBitmap = { w: 0, h: 0, bx: 0, by: 0, adv, data: new Uint8Array(0) };
      this.glyphCache.set(key, empty);
      return empty;
    }
    const pad = 1;
    const x0 = Math.floor(minX) - pad;
    const x1 = Math.ceil(maxX) + pad;
    const y0 = Math.floor(minY) - pad;
    const y1 = Math.ceil(maxY) + pad;
    const w = x1 - x0;
    const h = y1 - y0;
    const data = new Uint8Array(w * h);
    // scanline fill, non-zero winding; y down in bitmap space
    for (let row = 0; row < h; row++) {
      const yc = y0 + row + 0.5; // font units, y up
      const xs: [number, number][] = [];
      for (const [a, b] of allSegs) {
        const ay = a[1];
        const by = b[1];
        if ((ay <= yc && yc < by) || (by <= yc && yc < ay)) {
          const x = a[0] + ((yc - ay) * (b[0] - a[0])) / (by - ay);
          xs.push([x, by > ay ? 1 : -1]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p[0] - q[0]);
      let winding = 0;
      for (let i = 0; i + 1 < xs.length; i++) {
        winding += xs[i][1];
        if (winding !== 0) {
          const xa = Math.max(0, Math.ceil(xs[i][0] - x0));
          const xb = Math.min(w - 1, Math.floor(xs[i + 1][0] - x0));
          for (let xx = xa; xx <= xb; xx++) data[row * w + xx] = 255;
        }
      }
    }
    // bitmap rows are y-up; flip so row 0 is top
    const flipped = new Uint8Array(w * h);
    for (let r = 0; r < h; r++) {
      flipped.set(data.subarray((h - 1 - r) * w, (h - r) * w), r * w);
    }
    const bmp: GlyphBitmap = { w, h, bx: x0, by: y1, adv, data: flipped };
    this.glyphCache.set(key, bmp);
    return bmp;
  }
}
interface GlyphBitmap {
  w: number;
  h: number;
  bx: number; // left bearing in px (bitmap left edge relative to pen x)
  by: number; // top of bitmap above baseline in px
  adv: number; // advance in px
  data: Uint8Array;
}

const F_REG = new Font(readFileSync(join(HERE, "fonts", "LiberationSerif-Regular.ttf")));
const F_BOLD = new Font(readFileSync(join(HERE, "fonts", "LiberationSerif-Bold.ttf")));
const F_ITAL = new Font(readFileSync(join(HERE, "fonts", "LiberationSerif-Italic.ttf")));
const F_BI = new Font(readFileSync(join(HERE, "fonts", "LiberationSerif-BoldItalic.ttf")));

// Draw text; x,y are logical coords, y = baseline.
function text(str: string, x: number, y: number, font: Font, size: number, c: RGB, align: "l" | "c" | "r" = "l"): void {
  const px = size * SS;
  const w = font.measure(str, px);
  let penX = x * SS;
  if (align === "c") penX -= w / 2;
  else if (align === "r") penX -= w;
  const baseY = Math.round(y * SS);
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    const g = font.rasterize(code, px);
    if (g.w > 0) {
      const X0 = Math.round(penX) + g.bx;
      const Y0 = baseY - Math.round(g.by);
      for (let r = 0; r < g.h; r++) {
        const yy = Y0 + r;
        if (yy < clipY0 * SS || yy >= clipY1 * SS) continue;
        for (let col = 0; col < g.w; col++) {
          const a = g.data[r * g.w + col];
          if (a === 0) continue;
          const xx = X0 + col;
          if (xx < clipX0 * SS || xx >= clipX1 * SS) continue;
          blend(yy * W2 + xx, c, a);
        }
      }
    }
    penX += g.adv;
  }
}
function wrap(str: string, font: Font, size: number, maxW: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const trial = cur ? cur + " " + wd : wd;
    if (font.measure(trial, size * SS) / SS <= maxW || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
function para(str: string, x: number, y: number, font: Font, size: number, leading: number, maxW: number, c: RGB, maxLines = 99): number {
  const lines = wrap(str, font, size, maxW).slice(0, maxLines);
  lines.forEach((ln, i) => text(ln, x, y + i * leading, font, size, c));
  return lines.length;
}

// ---------------------------------------------------------------- content
// All facts from brief-v8 (full-day, 22 Nov 2026). No competitor text.
type Status = "CONFIRMED" | "CLAIM" | "REPORTED" | "PENDING";
const STATUS_COLOR: Record<Status, RGB> = {
  CONFIRMED: GREEN,
  CLAIM: RED,
  REPORTED: AMBER,
  PENDING: [110, 108, 100],
};
const STATUS_TEXT: Record<Status, RGB> = {
  CONFIRMED: WHITE,
  CLAIM: WHITE,
  REPORTED: [40, 30, 10],
  PENDING: WHITE,
};
interface Story {
  n: number;
  loc: string;
  cat: string;
  head: string;
  body: string;
  src: string;
  status: Status;
  region: string;
  scene: string;
}
const LEADS: Story[] = [
  {
    n: 1, loc: "ANTALYA, TÜRKIYE", cat: "CLIMATE",
    head: "COP31 collapses with no deal",
    body: "After two days of overtime, the summit ends Sunday with no deal. The EU and about 130 nations reject a text that drops fossil fuels; COP31 President Kurum admits there is no consensus.",
    src: "Reuters · CNN · AP", status: "CONFIRMED", region: "EUROPE", scene: "cop31",
  },
  {
    n: 2, loc: "DYMER, UKRAINE", cat: "WAR",
    head: "Strike on Dymer block kills at least 10",
    body: "A drone hits a five-storey apartment block about 45 km north of Kyiv in the early hours of Sunday; the building partly collapses. A seven-year-old boy is pulled out alive after 14 hours; a 79-year-old woman is rescued; 11 were missing.",
    src: "Kyiv regional officials · SES", status: "CONFIRMED", region: "EUROPE", scene: "dymer",
  },
  {
    n: 3, loc: "MANAMA, BAHRAIN", cat: "IRAN",
    head: "Iran claims two US radars hit; US denies damage",
    body: "The IRGC claims it destroyed two US Patriot radars at Al-Riffa and Awali. The US: no damage to US personnel or facilities. Bahrain: targets intercepted; fire at a civilian site; 2 hurt.",
    src: "IRIB / Al Jazeera · CBS · Bahrain", status: "CLAIM", region: "MIDDLE EAST", scene: "radar",
  },
];
const GRID: Story[] = [
  {
    n: 4, loc: "GULF OF FINLAND", cat: "SEA",
    head: "Russian cargo ship Sparta II still ablaze",
    body: "Sanctioned ship hit by a suspected Ukrainian drone; fire rages overnight.",
    src: "AP · Finnish Border Guard", status: "CONFIRMED", region: "EUROPE", scene: "ship",
  },
  {
    n: 5, loc: "PERU", cat: "EARTHQUAKE",
    head: "Magnitude 6.8 quake shakes Peru's Andes",
    body: "Tremor sends Lima residents fleeing; no word of casualties.",
    src: "Wire reports", status: "REPORTED", region: "AMERICAS", scene: "quake",
  },
  {
    n: 6, loc: "JERUSALEM", cat: "POLITICS",
    head: "Eisenkot asked to form Israel's government",
    body: "President Herzog passes over Netanyahu; mandate ceremony on Sunday.",
    src: "Brief wires", status: "REPORTED", region: "MIDDLE EAST", scene: "govt",
  },
  {
    n: 7, loc: "UKRAINE", cat: "WAR",
    head: "Missiles hit Zelenskyy's hometown, 2 dead",
    body: "Kryvyi Rih: 60 hurt, a hospital and 25 blocks hit.",
    src: "AP", status: "REPORTED", region: "EUROPE", scene: "missile",
  },
  {
    n: 8, loc: "MEXICO", cat: "CARTELS",
    head: "11 killed after cartel boss is captured",
    body: "\u201CEl Chapo Isidro\u201D Meza Flores seized in Sinaloa.",
    src: "France 24", status: "REPORTED", region: "AMERICAS", scene: "arrest",
  },
  {
    n: 9, loc: "HONG KONG", cat: "ELECTION",
    head: "Hong Kong votes fill all 723 seats",
    body: "723 seats from 856 candidates, 31 subsectors; record 98.79% turnout.",
    src: "Xinhua · China Daily", status: "CONFIRMED", region: "ASIA-PACIFIC", scene: "vote",
  },
  {
    n: 10, loc: "HORMUZ", cat: "SEA",
    head: "Two tankers hit and set ablaze near Hormuz",
    body: "Two tankers hit near Khasab; crews evacuated, no casualties. Iran claims mines — unverified.",
    src: "UKMTO · IRNA / IRIB", status: "REPORTED", region: "MIDDLE EAST", scene: "tankers",
  },
  {
    n: 11, loc: "HORMUZ", cat: "AIR",
    head: "Iran claims 20th US MQ-1 drone downed",
    body: "IRGC claims a US MQ-1 downed east of Hormuz, the 20th of the war; US yet to comment.",
    src: "IRIB / Al Jazeera", status: "CLAIM", region: "MIDDLE EAST", scene: "drone",
  },
  {
    n: 12, loc: "BRUSSELS", cat: "TRADE",
    head: "EU and Indonesia sign landmark trade deal",
    body: "Signed Saturday in Brussels after ~10 years of talks; removes 98.5% of tariffs.",
    src: "European Commission · Reuters", status: "CONFIRMED", region: "EUROPE", scene: "trade",
  },
  {
    n: 13, loc: "SOMALIA", cat: "DIPLOMACY",
    head: "Somalia orders UAE envoy to leave",
    body: "Mogadishu withdraws its ambassador too.",
    src: "Brief wires", status: "REPORTED", region: "AFRICA", scene: "envoy",
  },
  {
    n: 14, loc: "GAZA", cat: "AID",
    head: "Four nations press Israel on Gaza aid",
    body: "Australia, Canada, Italy and Britain cite flood suffering.",
    src: "Brief wires", status: "REPORTED", region: "MIDDLE EAST", scene: "aid",
  },
  {
    n: 15, loc: "LAS VEGAS", cat: "FORMULA 1",
    head: "Verstappen wins the Las Vegas Grand Prix",
    body: "Third win in four years; 35 lead changes; beats Antonelli and Russell.",
    src: "F1", status: "CONFIRMED", region: "AMERICAS", scene: "f1",
  },
];
const WIRES: [number, string, string][] = [
  [16, "Court backs $7.25bn Roundup settlement", "US · COURTS"],
  [17, "England thrash the All Blacks 37-12", "RUGBY"],
  [18, "Arsenal held 2-2; Leeds stun Chelsea 4-1", "FOOTBALL"],
  [19, "Estonia to close its Russia border; Moscow cries \u201CIron Curtain\u201D", "ESTONIA"],
  [20, "France: police jailed for racist violence, a landmark ruling", "FRANCE"],
  [21, "France: 6th straight Saturday of cost-of-living protests", "FRANCE"],
  [22, "US: Trump warns of a \u201Ctremendous tax\u201D on AI centres abroad", "US"],
  [23, "US: man convicted of starting the deadly 2025 Palisades fire", "US"],
  [24, "US: State Dept details $12bn of Venezuelan oil revenue", "US"],
  [25, "US: Trump ousts cyber director after outage criticism", "US"],
  [26, "Ebola: the death toll passes 5,700, containment goes on", "EBOLA"],
  [27, "Myanmar: France seeks UN action on the genocide ruling", "MYANMAR"],
  [28, "India-China: commanders meet on the Arunachal frontier", "INDIA-CHINA"],
  [29, "Japan: forces to train live-fire at Indian facilities, a first", "JAPAN"],
  [30, "India: Air India extends Jeddah suspension to 24 Nov", "INDIA"],
  [31, "India: ICMR signs off 100 health technology transfers", "INDIA"],
  [32, "Cricket: Rahul's century headlines India's Test in NZ", "CRICKET"],
  [33, "Cricket: Cummins wins unanimous backing as Australia captain", "CRICKET"],
  [34, "Switzerland: 4,000-year-old bronze ring found in melting ice", "SWITZERLAND"],
  [35, "Australia: bystanders pull a driver from a burning car, Canberra", "AUSTRALIA"],
  [36, "Football: PSG win 3-2 at Nice; Doue hurt badly", "FOOTBALL"],
];
const REGIONS: [string, number, RGB][] = [
  ["EUROPE", 10, TEAL],
  ["MIDDLE EAST", 5, RED],
  ["AMERICAS", 8, GREEN],
  ["ASIA-PACIFIC", 7, AMBER],
  ["AFRICA", 2, BROWN],
  ["OCEANIA", 2, OLIVE],
  ["WORLD", 2, [90, 88, 82]],
];
const TIMELINE: [string, string][] = [
  ["03:00", "COP31 objections due"],
  ["05:30", "Verstappen wins Vegas"],
  ["06:00", "COP31 plenary — no deal"],
  ["MORNING", "Dymer strike"],
  ["EVENING", "Hong Kong results"],
  ["NIGHT", "COP31 collapses"],
];
const NUMBERS: [string, string, RGB][] = [
  ["186", "drones at Ukraine overnight", AMBER],
  ["10", "Dymer dead, at least", [232, 122, 74]],
  ["2", "US radars claimed hit", GOLD],
  ["723", "Hong Kong seats filled", [139, 178, 92]],
  ["98.5%", "tariffs removed, EU–Indonesia", AMBER],
  ["$7.25bn", "Roundup settlement", GOLD],
];
const DATE_CHECK =
  "DATE CHECK — FULL-DAY EDITION: wires through the end of Sunday 22 November 2026. Left out as Saturday 21 November news: the Kyiv bridge strikes, the Shenzhen summit and India's Nitish Setu opening — and the Lviv strike (Friday 20 Nov). Now included (22 November): COP31's collapse, the Dymer strike, Iran's Bahrain radar claim, Hong Kong's vote count, the Hormuz tanker fires, the MQ-1 claim. COP31's vote is no longer pending — the summit ended with no deal.";

// ---------------------------------------------------------------- chips
function chip(x: number, y: number, label: string, bg: RGB, fg: RGB, size = 8.5): number {
  const w = F_BOLD.measure(label, size * SS) / SS + 9;
  rrect(x, y, w, 13, 2.5, bg);
  text(label, x + w / 2, y + 10, F_BOLD, size, fg, "c");
  return w;
}
function chipWidth(label: string, size = 8.5): number {
  return F_BOLD.measure(label, size * SS) / SS + 9;
}
function statusChip(x: number, y: number, s: Status, size = 8.5): number {
  return chip(x, y, s, STATUS_COLOR[s], STATUS_TEXT[s], size);
}
function numBadge(x: number, y: number, n: number, r = 8): void {
  circle(x, y, r, RED);
  circle(x, y, r - 1.2, WHITE);
  circle(x, y, r - 2.4, RED);
  text(String(n), x, y + 3.4, F_BOLD, 9.5, WHITE, "c");
}

// ---------------------------------------------------------------- illustrations
// Every scene is drawn in code from the story it illustrates, in a warm
// amber / terracotta / olive / gold palette on cream. (x,y,w,h) logical.
function scene(kind: string, x: number, y: number, w: number, h: number): void {
  setClip(x, y, w, h);
  const u = w / 100;
  const v = h / 100;
  const sky = (c: RGB) => rect(x, y, w, h, c);
  switch (kind) {
    case "cop31": {
      sky([242, 200, 121]);
      // globe, left
      circle(x + 20 * u, y + 30 * v, 15 * u, OLIVE);
      ellipse(x + 14 * u, y + 26 * v, 6 * u, 4 * v, [201, 178, 110]);
      ellipse(x + 26 * u, y + 36 * v, 5 * u, 3.5 * v, [201, 178, 110]);
      // conference hall facade
      rect(x + 40 * u, y + 22 * v, 58 * u, 78 * v, [214, 184, 138]);
      poly([[x + 38 * u, y + 22 * v], [x + 69 * u, y + 8 * v], [x + 100 * u, y + 22 * v]], [178, 138, 88]);
      for (let i = 0; i < 4; i++) rect(x + (45 + i * 13) * u, y + 32 * v, 6 * u, 40 * v, [246, 238, 216]);
      // long table + delegates
      rect(x + 8 * u, y + 74 * v, 88 * u, 9 * v, [122, 84, 48]);
      const cols: RGB[] = [RED, OLIVE, AMBER, TEAL, BROWN];
      for (let i = 0; i < 5; i++) {
        const cx = x + (16 + i * 16) * u;
        circle(cx, y + 60 * v, 6.5 * u, cols[i]);
        poly([[cx - 8 * u, y + 76 * v], [cx + 8 * u, y + 76 * v], [cx + 5 * u, y + 66 * v], [cx - 5 * u, y + 66 * v]], cols[i]);
      }
      // red NO DEAL banner
      rrect(x + 58 * u, y + 4 * v, 40 * u, 13 * v, 2, RED_DARK);
      text("NO DEAL", x + 78 * u, y + 13.5 * v, F_BOLD, 8.5, WHITE, "c");
      break;
    }
    case "dymer": {
      sky([232, 165, 107]);
      circle(x + 82 * u, y + 18 * v, 8 * u, [245, 222, 160]); // pale moon
      // apartment block, broken top
      poly(
        [
          [x + 12 * u, y + 100 * v], [x + 12 * u, y + 38 * v], [x + 22 * u, y + 30 * v],
          [x + 30 * u, y + 40 * v], [x + 38 * u, y + 28 * v], [x + 46 * u, y + 38 * v],
          [x + 58 * u, y + 34 * v], [x + 58 * u, y + 100 * v],
        ],
        [196, 164, 118],
      );
      for (let r = 0; r < 4; r++)
        for (let cI = 0; cI < 3; cI++) {
          const wx = x + (17 + cI * 14) * u;
          const wy = y + (46 + r * 14) * v;
          if (r === 0 && cI === 1) continue; // blown-out window
          rect(wx, wy, 7 * u, 8 * v, r === 1 && cI === 2 ? [60, 48, 36] : NAVY_DARK);
        }
      // rubble + smoke
      poly([[x + 58 * u, y + 100 * v], [x + 70 * u, y + 78 * v], [x + 84 * u, y + 100 * v]], [150, 122, 84]);
      poly([[x + 66 * u, y + 100 * v], [x + 78 * u, y + 86 * v], [x + 92 * u, y + 100 * v]], [122, 96, 62]);
      circle(x + 30 * u, y + 22 * v, 7 * u, [120, 108, 92]);
      circle(x + 40 * u, y + 14 * v, 9 * u, [140, 128, 110]);
      // rescue ladder
      line(x + 74 * u, y + 96 * v, x + 56 * u, y + 52 * v, 2.5, RED_DARK);
      break;
    }
    case "radar": {
      sky([122, 84, 62]);
      circle(x + 84 * u, y + 16 * v, 6 * u, [245, 200, 110]); // sun
      // ground + base buildings
      rect(x, y + 78 * v, w, 22 * v, [88, 62, 44]);
      rect(x + 58 * u, y + 62 * v, 34 * u, 16 * v, [150, 122, 88]);
      // two radar dishes
      const dish = (cx: number, cy: number, s: number) => {
        line(cx, cy, cx, y + 78 * v, 3, [220, 210, 190]);
        poly([[cx - 13 * s, cy - 4 * v], [cx + 13 * s, cy - 4 * v], [cx + 6 * s, cy + 10 * v], [cx - 6 * s, cy + 10 * v]], [232, 224, 200]);
        line(cx - 13 * s, cy - 4 * v, cx + 13 * s, cy - 4 * v, 2, [200, 190, 160]);
      };
      dish(x + 26 * u, y + 52 * v, 1);
      dish(x + 74 * u, y + 44 * v, 0.8);
      // missile streaks + burst
      line(x + 8 * u, y + 10 * v, x + 30 * u, y + 42 * v, 2, AMBER);
      line(x + 40 * u, y + 6 * v, x + 58 * u, y + 36 * v, 2, AMBER);
      circle(x + 62 * u, y + 40 * v, 6 * u, [245, 140, 50]);
      circle(x + 62 * u, y + 40 * v, 3 * u, [255, 210, 90]);
      break;
    }
    case "ship": {
      sky([240, 196, 120]);
      rect(x, y + 62 * v, w, 38 * v, [176, 118, 52]); // sea
      for (let i = 0; i < 3; i++) line(x + (6 + i * 30) * u, y + (72 + (i % 2) * 12) * v, x + (24 + i * 30) * u, y + (72 + (i % 2) * 12) * v, 2, [214, 160, 84]);
      // hull + containers
      poly([[x + 14 * u, y + 60 * v], [x + 88 * u, y + 60 * v], [x + 82 * u, y + 72 * v], [x + 20 * u, y + 72 * v]], [74, 56, 44]);
      rect(x + 22 * u, y + 40 * v, 16 * u, 20 * v, RED);
      rect(x + 40 * u, y + 44 * v, 16 * u, 16 * v, OLIVE);
      rect(x + 58 * u, y + 40 * v, 14 * u, 20 * v, AMBER);
      rect(x + 76 * u, y + 48 * v, 8 * u, 12 * v, [246, 238, 216]);
      // flames + smoke
      poly([[x + 26 * u, y + 40 * v], [x + 32 * u, y + 22 * v], [x + 38 * u, y + 40 * v]], [245, 140, 50]);
      poly([[x + 60 * u, y + 40 * v], [x + 66 * u, y + 26 * v], [x + 72 * u, y + 40 * v]], [255, 200, 80]);
      circle(x + 32 * u, y + 16 * v, 7 * u, [110, 100, 86]);
      circle(x + 44 * u, y + 10 * v, 9 * u, [130, 118, 102]);
      break;
    }
    case "quake": {
      sky([238, 196, 128]);
      // Andes peaks
      poly([[x, y + 100 * v], [x + 22 * u, y + 30 * v], [x + 44 * u, y + 100 * v]], [150, 110, 66]);
      poly([[x + 16 * u, y + 44 * v], [x + 22 * u, y + 30 * v], [x + 28 * u, y + 44 * v]], [246, 238, 216]);
      poly([[x + 38 * u, y + 100 * v], [x + 62 * u, y + 22 * v], [x + 86 * u, y + 100 * v]], [122, 90, 54]);
      poly([[x + 56 * u, y + 36 * v], [x + 62 * u, y + 22 * v], [x + 68 * u, y + 36 * v]], [246, 238, 216]);
      // shaking house
      poly([[x + 68 * u, y + 100 * v], [x + 70 * u, y + 74 * v], [x + 92 * u, y + 70 * v], [x + 94 * u, y + 100 * v]], [214, 184, 138]);
      poly([[x + 68 * u, y + 76 * v], [x + 81 * u, y + 64 * v], [x + 94 * u, y + 72 * v]], RED_DARK);
      // crack lines
      line(x + 78 * u, y + 76 * v, x + 82 * u, y + 88 * v, 1.5, INK);
      line(x + 82 * u, y + 88 * v, x + 78 * u, y + 96 * v, 1.5, INK);
      line(x + 8 * u, y + 96 * v, x + 96 * u, y + 96 * v, 2, [120, 96, 60]);
      break;
    }
    case "govt": {
      sky([240, 206, 140]);
      rect(x, y + 76 * v, w, 24 * v, [150, 122, 84]);
      // domed government building
      rect(x + 22 * u, y + 46 * v, 56 * u, 32 * v, [232, 214, 168]);
      poly([[x + 36 * u, y + 46 * v], [x + 50 * u, y + 26 * v], [x + 64 * u, y + 46 * v]], GOLD);
      circle(x + 50 * u, y + 30 * v, 4 * u, GOLD);
      for (let i = 0; i < 5; i++) rect(x + (27 + i * 10) * u, y + 54 * v, 4 * u, 24 * v, [246, 238, 216]);
      // flags
      line(x + 12 * u, y + 78 * v, x + 12 * u, y + 40 * v, 2, INK);
      poly([[x + 12 * u, y + 40 * v], [x + 24 * u, y + 45 * v], [x + 12 * u, y + 50 * v]], [70, 110, 160]);
      line(x + 88 * u, y + 78 * v, x + 88 * u, y + 40 * v, 2, INK);
      poly([[x + 88 * u, y + 40 * v], [x + 76 * u, y + 45 * v], [x + 88 * u, y + 50 * v]], RED);
      break;
    }
    case "missile": {
      sky([226, 158, 96]);
      // building hit, smoke plume
      rect(x + 12 * u, y + 44 * v, 34 * u, 56 * v, [196, 164, 118]);
      for (let r = 0; r < 3; r++) for (let cI = 0; cI < 2; cI++) rect(x + (17 + cI * 14) * u, y + (50 + r * 14) * v, 7 * u, 8 * v, NAVY_DARK);
      poly([[x + 46 * u, y + 44 * v], [x + 62 * u, y + 30 * v], [x + 74 * u, y + 44 * v]], [150, 122, 84]);
      circle(x + 60 * u, y + 22 * v, 9 * u, [110, 100, 86]);
      circle(x + 72 * u, y + 12 * v, 11 * u, [130, 118, 102]);
      // missile streak
      line(x + 84 * u, y + 8 * v, x + 58 * u, y + 40 * v, 2.5, AMBER);
      circle(x + 56 * u, y + 42 * v, 5 * u, [245, 140, 50]);
      // ambulance
      rect(x + 58 * u, y + 82 * v, 34 * u, 14 * v, [246, 238, 216]);
      rect(x + 84 * u, y + 86 * v, 8 * u, 8 * v, RED);
      circle(x + 66 * u, y + 97 * v, 3.5 * u, INK);
      circle(x + 84 * u, y + 97 * v, 3.5 * u, INK);
      break;
    }
    case "arrest": {
      sky([238, 192, 118]);
      rect(x, y + 74 * v, w, 26 * v, [150, 122, 84]);
      // police car
      poly([[x + 14 * u, y + 74 * v], [x + 22 * u, y + 58 * v], [x + 44 * u, y + 58 * v], [x + 52 * u, y + 74 * v]], [246, 238, 216]);
      rect(x + 10 * u, y + 70 * v, 76 * u, 10 * v, [246, 238, 216]);
      circle(x + 24 * u, y + 82 * v, 4.5 * u, INK);
      circle(x + 70 * u, y + 82 * v, 4.5 * u, INK);
      rect(x + 28 * u, y + 54 * v, 8 * u, 4 * v, RED);
      rect(x + 38 * u, y + 54 * v, 8 * u, 4 * v, TEAL);
      // handcuffs
      circle(x + 74 * u, y + 30 * v, 8 * u, [200, 176, 120]);
      circle(x + 74 * u, y + 30 * v, 4.5 * u, [238, 192, 118]);
      circle(x + 88 * u, y + 22 * v, 8 * u, [200, 176, 120]);
      circle(x + 88 * u, y + 22 * v, 4.5 * u, [238, 192, 118]);
      line(x + 74 * u, y + 30 * v, x + 88 * u, y + 22 * v, 2.5, [200, 176, 120]);
      // gold star badge
      poly([[x + 18 * u, y + 14 * v], [x + 21 * u, y + 21 * v], [x + 28 * u, y + 21 * v], [x + 22.5 * u, y + 26 * v], [x + 24.5 * u, y + 33 * v], [x + 18 * u, y + 29 * v], [x + 11.5 * u, y + 33 * v], [x + 13.5 * u, y + 26 * v], [x + 8 * u, y + 21 * v], [x + 15 * u, y + 21 * v]], GOLD);
      break;
    }
    case "vote": {
      sky([240, 200, 128]);
      // ballot box + booth
      rect(x + 14 * u, y + 30 * v, 40 * u, 52 * v, RED);
      rect(x + 10 * u, y + 24 * v, 48 * u, 8 * v, RED_DARK);
      rect(x + 26 * u, y + 26 * v, 16 * u, 3 * v, INK);
      rect(x + 30 * u, y + 12 * v, 14 * u, 16 * v, WHITE);
      line(x + 32 * u, y + 24 * v, x + 36 * u, y + 28 * v, 1.5, INK);
      line(x + 36 * u, y + 28 * v, x + 42 * u, y + 18 * v, 1.5, INK);
      // big green check
      line(x + 62 * u, y + 52 * v, x + 72 * u, y + 66 * v, 5, GREEN);
      line(x + 72 * u, y + 66 * v, x + 94 * u, y + 30 * v, 5, GREEN);
      // ballot papers
      rect(x + 60 * u, y + 76 * v, 30 * u, 12 * v, WHITE);
      line(x + 64 * u, y + 80 * v, x + 86 * u, y + 80 * v, 1.5, INK_SOFT);
      line(x + 64 * u, y + 84 * v, x + 82 * u, y + 84 * v, 1.5, INK_SOFT);
      break;
    }
    case "tankers": {
      sky([240, 188, 110]);
      rect(x, y + 60 * v, w, 40 * v, [176, 118, 52]);
      for (let i = 0; i < 3; i++) line(x + (8 + i * 32) * u, y + (72 + (i % 2) * 10) * v, x + (26 + i * 32) * u, y + (72 + (i % 2) * 10) * v, 2, [214, 160, 84]);
      // tanker 1
      poly([[x + 8 * u, y + 56 * v], [x + 46 * u, y + 56 * v], [x + 42 * u, y + 68 * v], [x + 12 * u, y + 68 * v]], [74, 56, 44]);
      rect(x + 38 * u, y + 44 * v, 6 * u, 12 * v, [246, 238, 216]);
      poly([[x + 16 * u, y + 56 * v], [x + 22 * u, y + 40 * v], [x + 28 * u, y + 56 * v]], [245, 140, 50]);
      circle(x + 22 * u, y + 34 * v, 6 * u, [110, 100, 86]);
      // tanker 2
      poly([[x + 56 * u, y + 58 * v], [x + 92 * u, y + 58 * v], [x + 88 * u, y + 70 * v], [x + 60 * u, y + 70 * v]], [96, 72, 52]);
      rect(x + 84 * u, y + 46 * v, 6 * u, 12 * v, [246, 238, 216]);
      poly([[x + 64 * u, y + 58 * v], [x + 70 * u, y + 42 * v], [x + 76 * u, y + 58 * v]], [255, 200, 80]);
      circle(x + 70 * u, y + 36 * v, 6 * u, [130, 118, 102]);
      break;
    }
    case "drone": {
      sky([150, 96, 66]);
      circle(x + 80 * u, y + 20 * v, 7 * u, [245, 200, 110]);
      // MQ-1 silhouette: long wing, fuselage, tail
      rect(x + 30 * u, y + 44 * v, 44 * u, 3.5 * v, [60, 54, 48]);
      ellipse(x + 52 * u, y + 52 * v, 12 * u, 4 * v, [74, 66, 58]);
      line(x + 52 * u, y + 52 * v, x + 52 * u, y + 66 * v, 2, [74, 66, 58]);
      line(x + 44 * u, y + 66 * v, x + 60 * u, y + 66 * v, 2, [74, 66, 58]);
      circle(x + 64 * u, y + 52 * v, 2.5 * u, [245, 140, 50]);
      // explosion burst below
      poly([[x + 18 * u, y + 78 * v], [x + 24 * u, y + 64 * v], [x + 30 * u, y + 78 * v], [x + 36 * u, y + 66 * v], [x + 42 * u, y + 78 * v]], [245, 140, 50]);
      circle(x + 30 * u, y + 80 * v, 4 * u, [255, 210, 90]);
      // debris dots
      circle(x + 12 * u, y + 60 * v, 1.8 * u, [60, 54, 48]);
      circle(x + 84 * u, y + 70 * v, 1.8 * u, [60, 54, 48]);
      circle(x + 90 * u, y + 44 * v, 1.8 * u, [60, 54, 48]);
      break;
    }
    case "trade": {
      sky([240, 198, 122]);
      // signing table + document
      rect(x + 8 * u, y + 70 * v, 84 * u, 10 * v, [122, 84, 48]);
      rect(x + 26 * u, y + 48 * v, 34 * u, 24 * v, WHITE);
      line(x + 30 * u, y + 54 * v, x + 56 * u, y + 54 * v, 1.5, INK_SOFT);
      line(x + 30 * u, y + 59 * v, x + 56 * u, y + 59 * v, 1.5, INK_SOFT);
      line(x + 30 * u, y + 64 * v, x + 46 * u, y + 64 * v, 1.5, INK_SOFT);
      circle(x + 54 * u, y + 68 * v, 3 * u, RED);
      // pen
      line(x + 62 * u, y + 52 * v, x + 72 * u, y + 62 * v, 2, INK);
      // circle of gold stars on navy disc
      circle(x + 78 * u, y + 34 * v, 17 * u, NAVY);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        circle(x + 78 * u + Math.cos(a) * 11 * u, y + 34 * v + Math.sin(a) * 11 * v, 1.6 * u, GOLD);
      }
      circle(x + 78 * u, y + 34 * v, 3 * u, GOLD);
      // hands shaking: two sleeves
      poly([[x + 8 * u, y + 86 * v], [x + 30 * u, y + 80 * v], [x + 30 * u, y + 90 * v], [x + 8 * u, y + 96 * v]], TEAL);
      poly([[x + 92 * u, y + 86 * v], [x + 70 * u, y + 80 * v], [x + 70 * u, y + 90 * v], [x + 92 * u, y + 96 * v]], RED);
      break;
    }
    case "envoy": {
      sky([238, 194, 122]);
      // embassy building + flag
      rect(x + 16 * u, y + 40 * v, 52 * u, 48 * v, [214, 184, 138]);
      poly([[x + 14 * u, y + 40 * v], [x + 42 * u, y + 26 * v], [x + 70 * u, y + 40 * v]], [178, 138, 88]);
      rect(x + 38 * u, y + 68 * v, 10 * u, 20 * v, NAVY_DARK);
      for (let i = 0; i < 3; i++) rect(x + (22 + i * 16) * u, y + 50 * v, 7 * u, 8 * v, NAVY_DARK);
      line(x + 76 * u, y + 88 * v, x + 76 * u, y + 34 * v, 2, INK);
      poly([[x + 76 * u, y + 34 * v], [x + 92 * u, y + 39 * v], [x + 76 * u, y + 44 * v]], [110, 160, 200]);
      circle(x + 84 * u, y + 39 * v, 2.5 * u, WHITE);
      // departing plane + dashed path
      poly([[x + 12 * u, y + 18 * v], [x + 30 * u, y + 12 * v], [x + 30 * u, y + 22 * v]], [246, 238, 216]);
      line(x + 30 * u, y + 16 * v, x + 52 * u, y + 10 * v, 1.5, [246, 238, 216]);
      break;
    }
    case "aid": {
      sky([240, 198, 124]);
      rect(x, y + 76 * v, w, 24 * v, [170, 134, 88]);
      // two aid trucks
      const truck = (tx: number, ty: number, s: number) => {
        rect(tx, ty, 34 * s, 16 * s, [246, 238, 216]);
        rect(tx + 34 * s, ty + 6 * s, 12 * s, 10 * s, [232, 220, 196]);
        rect(tx + 8 * s, ty + 4 * s, 18 * s, 8 * s, GREEN);
        circle(tx + 10 * s, ty + 17 * s, 3.5 * s, INK);
        circle(tx + 36 * s, ty + 17 * s, 3.5 * s, INK);
      };
      truck(x + 8 * u, y + 58 * v, u);
      truck(x + 54 * u, y + 62 * v, u * 0.9);
      // stacked boxes + sacks
      rect(x + 12 * u, y + 40 * v, 14 * u, 10 * v, AMBER);
      rect(x + 28 * u, y + 42 * v, 12 * u, 8 * v, OLIVE);
      ellipse(x + 72 * u, y + 46 * v, 10 * u, 6 * v, [214, 184, 138]);
      ellipse(x + 84 * u, y + 48 * v, 8 * u, 5 * v, [196, 164, 118]);
      // sun
      circle(x + 86 * u, y + 16 * v, 7 * u, [245, 200, 110]);
      break;
    }
    case "f1": {
      sky([238, 190, 116]);
      // skyline + sun
      rect(x + 6 * u, y + 34 * v, 10 * u, 40 * v, [150, 110, 66]);
      rect(x + 20 * u, y + 24 * v, 12 * u, 50 * v, [122, 90, 54]);
      rect(x + 78 * u, y + 30 * v, 10 * u, 44 * v, [150, 110, 66]);
      circle(x + 88 * u, y + 16 * v, 7 * u, [245, 200, 110]);
      // track
      rect(x, y + 74 * v, w, 26 * v, [74, 66, 60]);
      line(x, y + 78 * v, x + w, y + 78 * v, 1.5, [246, 238, 216]);
      line(x, y + 94 * v, x + w, y + 94 * v, 1.5, [246, 238, 216]);
      // race car
      poly([[x + 22 * u, y + 72 * v], [x + 34 * u, y + 58 * v], [x + 58 * u, y + 58 * v], [x + 72 * u, y + 72 * v]], RED);
      rect(x + 20 * u, y + 66 * v, 54 * u, 8 * v, RED_DARK);
      rect(x + 66 * u, y + 52 * v, 10 * u, 8 * v, RED);
      circle(x + 32 * u, y + 74 * v, 5 * u, INK);
      circle(x + 32 * u, y + 74 * v, 2 * u, [200, 200, 190]);
      circle(x + 62 * u, y + 74 * v, 5 * u, INK);
      circle(x + 62 * u, y + 74 * v, 2 * u, [200, 200, 190]);
      // checkered flag
      line(x + 84 * u, y + 66 * v, x + 84 * u, y + 40 * v, 2, INK);
      for (let r = 0; r < 3; r++)
        for (let cI = 0; cI < 3; cI++) {
          if ((r + cI) % 2 === 0) rect(x + (84 + cI * 4) * u, y + (40 + r * 4) * v, 4 * u, 4 * v, INK);
          else rect(x + (84 + cI * 4) * u, y + (40 + r * 4) * v, 4 * u, 4 * v, WHITE);
        }
      break;
    }
    default:
      sky([240, 200, 130]);
  }
  clearClip();
}

// ---------------------------------------------------------------- world map
// Simplified continent outlines as [lon, lat] polygons (equirectangular).
// Land: olive-sepia; ocean: warm parchment. NOT blue.
const CONTINENTS: [number, number][][] = [
  // North America
  [[-168, 66], [-162, 58], [-155, 58], [-148, 60], [-140, 60], [-135, 57], [-130, 54], [-126, 50], [-124, 44], [-121, 37], [-117, 33], [-112, 29], [-108, 25], [-105, 21], [-100, 18], [-96, 16], [-92, 15], [-88, 13], [-84, 10], [-81, 8], [-79, 9], [-77, 8], [-75, 10], [-72, 12], [-76, 18], [-80, 26], [-81, 31], [-76, 35], [-74, 40], [-70, 42], [-68, 45], [-65, 44], [-60, 47], [-55, 47], [-60, 50], [-64, 58], [-68, 58], [-72, 62], [-78, 62], [-85, 66], [-92, 66], [-95, 69], [-110, 68], [-125, 70], [-140, 70], [-155, 71], [-165, 68]],
  // Greenland
  [[-58, 64], [-52, 60], [-43, 60], [-40, 64], [-32, 68], [-22, 70], [-25, 76], [-35, 80], [-50, 80], [-60, 76], [-58, 70]],
  // South America
  [[-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18], [-70, -23], [-70, -30], [-72, -37], [-73, -44], [-70, -52], [-66, -55], [-68, -50], [-65, -45], [-62, -40], [-58, -34], [-52, -32], [-48, -28], [-41, -23], [-39, -17], [-35, -9], [-35, -6], [-40, -3], [-44, -2], [-50, 0], [-52, 4], [-55, 6], [-60, 8], [-62, 10], [-68, 11], [-72, 12], [-75, 11]],
  // Africa
  [[-17, 15], [-17, 21], [-15, 27], [-10, 31], [-5, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [34, 28], [35, 23], [37, 20], [39, 15], [41, 11], [43, 11], [46, 11], [51, 12], [51, 10], [48, 5], [42, 0], [40, -5], [40, -10], [38, -15], [36, -20], [33, -26], [28, -33], [20, -35], [17, -32], [15, -27], [12, -18], [12, -10], [13, -5], [9, -1], [9, 4], [4, 6], [-8, 4], [-13, 8], [-17, 12]],
  // Eurasia
  [[-10, 36], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-2, 49], [0, 51], [3, 53], [7, 54], [8, 57], [10, 59], [5, 60], [5, 62], [10, 64], [12, 66], [18, 69], [25, 71], [30, 70], [35, 68], [40, 68], [45, 68], [55, 69], [65, 70], [75, 72], [85, 73], [95, 75], [105, 77], [115, 74], [125, 72], [135, 72], [145, 72], [155, 70], [162, 66], [170, 66], [178, 65], [178, 62], [170, 60], [162, 60], [158, 56], [155, 52], [150, 60], [142, 59], [142, 54], [140, 50], [135, 44], [130, 42], [127, 40], [122, 38], [120, 32], [118, 28], [112, 22], [108, 18], [105, 10], [103, 8], [100, 8], [98, 12], [95, 16], [92, 21], [89, 22], [86, 20], [82, 17], [80, 13], [77, 8], [75, 10], [72, 20], [68, 23], [66, 25], [62, 25], [58, 26], [56, 27], [54, 26], [52, 25], [50, 29], [48, 30], [44, 29], [42, 27], [40, 25], [39, 21], [38, 18], [35, 16], [33, 15], [34, 12], [36, 13], [39, 15], [43, 12], [45, 12], [48, 14], [51, 16], [55, 17], [58, 20], [59, 22], [57, 25], [54, 26], [52, 26], [50, 26], [48, 24], [44, 20], [42, 15], [40, 15], [38, 20], [36, 24], [35, 28], [34, 31], [33, 31], [30, 36], [27, 37], [26, 38], [23, 36], [22, 37], [19, 42], [19, 44], [15, 44], [12, 44], [10, 44], [8, 44], [3, 43], [0, 40], [-2, 37], [-6, 36], [-9, 37]],
  // United Kingdom
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
  // Japan
  [[130, 31], [132, 33], [134, 34], [136, 35], [138, 35], [140, 36], [141, 39], [141, 42], [143, 44], [145, 44], [142, 42], [140, 39], [139, 37], [137, 36], [135, 34], [133, 34], [131, 32]],
  // Australia
  [[114, -22], [114, -30], [115, -33], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
  // New Zealand
  [[167, -45], [170, -43], [173, -41], [175, -38], [177, -38], [175, -40], [172, -42], [168, -46]],
  // Madagascar
  [[44, -16], [47, -15], [50, -16], [49, -20], [45, -25], [43, -22], [43, -18]],
  // Sumatra
  [[95, 5], [100, 0], [104, -3], [106, -6], [102, -5], [98, 2]],
  // Borneo
  [[109, 1], [113, 4], [117, 2], [119, -1], [116, -4], [111, -3]],
  // Java
  [[105, -6], [110, -7], [114, -8], [112, -8], [107, -7]],
  // New Guinea
  [[131, -1], [136, -2], [141, -3], [146, -6], [150, -8], [147, -9], [142, -8], [136, -6], [132, -4]],
];
// Pin positions, checked against real geography:
// 1 Antalya 36.9N 30.7E · 2 Dymer 50.8N 30.3E · 3 Bahrain 26.2N 50.6E
// 4 Gulf of Finland 59.8N 25.0E · 5 Lima 12.0S 77.0W · 6 Jerusalem 31.8N 35.2E
// 7 Kryvyi Rih 47.9N 33.4E · 8 Sinaloa 24.8N 107.4W · 9 Hong Kong 22.3N 114.2E
// 10 Khasab 26.2N 56.2E · 11 Hormuz east 25.0N 58.8E · 12 Brussels 50.9N 4.4E
// 13 Mogadishu 2.0N 45.3E · 14 Gaza 31.5N 34.5E · 15 Las Vegas 36.2N 115.1W
// (badge dx,dy in px — leaders where pins cluster: 1/6/14, 2/7, 3/10/11)
const PINS: [number, number, number, number, number][] = [
  [1, 30.7, 36.9, 0, -11],
  [2, 30.3, 50.8, 0, 0],
  [3, 50.6, 26.2, -3, -12],
  [4, 25.0, 59.8, 0, 0],
  [5, -77.0, -12.0, 0, 0],
  [6, 35.2, 31.8, 0, 0],
  [7, 33.4, 47.9, 12, 3],
  [8, -107.4, 24.8, 0, 0],
  [9, 114.2, 22.3, 0, 0],
  [10, 56.2, 26.2, 0, 0],
  [11, 58.8, 25.0, 14, 9],
  [12, 4.4, 50.9, 0, 0],
  [13, 45.3, 2.0, 0, 0],
  [14, 34.5, 31.5, 13, 8],
  [15, -115.1, 36.2, 0, 0],
];
function drawMap(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, MAP_BG);
  const latMax = 84;
  const latMin = -58;
  const scale = h / (latMax - latMin);
  const worldW = 360 * scale;
  const ox = x + (w - worldW) / 2;
  const oy = y;
  const px = (lon: number) => ox + (lon + 180) * scale;
  const py = (lat: number) => oy + (latMax - lat) * scale;
  for (const cont of CONTINENTS) {
    poly(cont.map(([lo, la]) => [px(lo), py(la)] as [number, number]), MAP_LAND);
  }
  // pin dots + numbered badges
  for (const [n, lon, lat, dx, dy] of PINS) {
    const cx = px(lon);
    const cy = py(lat);
    const bx = cx + dx;
    const by = cy + dy;
    if (dx !== 0 || dy !== 0) {
      line(cx, cy, bx, by, 1, INK_SOFT);
      circle(cx, cy, 2.2, RED_DARK);
    }
    circle(bx, by, 7, RED_DARK);
    circle(bx, by, 6, WHITE);
    circle(bx, by, 5, RED);
    text(String(n), bx, by + 3, F_BOLD, 8.5, WHITE, "c");
  }
  // pin key, bottom-left of the map panel
  text("1 ANTALYA · 2 DYMER · 3 BAHRAIN · 4 GULF OF FINLAND · 5 PERU · 6 JERUSALEM · 7 KRYVYI RIH · 8 SINALOA", x + 4, y + h - 16, F_BOLD, 7.5, INK_SOFT);
  text("9 HONG KONG · 10 HORMUZ · 11 HORMUZ (MQ-1) · 12 BRUSSELS · 13 MOGADISHU · 14 GAZA · 15 LAS VEGAS", x + 4, y + h - 5, F_BOLD, 7.5, INK_SOFT);
}

// ---------------------------------------------------------------- layout
const MX = 14;
const RX = 1010;
const CW = RX - MX;
function regionColor(name: string): RGB {
  for (const [n, , c] of REGIONS) if (n === name) return c;
  return INK_SOFT;
}
function border(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, 0.7, PAPER_LINE);
  rect(x, y + h - 0.7, w, 0.7, PAPER_LINE);
  rect(x, y, 0.7, h, PAPER_LINE);
  rect(x + w - 0.7, y, 0.7, h, PAPER_LINE);
}
function drawTopBar(): void {
  const y = 8;
  text("36 STORIES · 7 REGIONS · ALL FROM THIS ONE DAY", MX, y + 11, F_BOLD, 12, INK);
  let cx = MX + F_BOLD.measure("36 STORIES · 7 REGIONS · ALL FROM THIS ONE DAY", 12 * SS) / SS + 14;
  for (const [name, count, col] of REGIONS) {
    const label = `${name} ${count}`;
    const w = F_BOLD.measure(label, 9 * SS) / SS + 12;
    rrect(cx, y + 1, w, 14, 2.5, col);
    text(label, cx + w / 2, y + 11.5, F_BOLD, 9, WHITE, "c");
    cx += w + 4;
  }
  text("PRESS TIME 23:59 UTC", RX, y + 11, F_BOLD, 11, RED, "r");
}
function drawMasthead(): void {
  text("Sunday 22 November 2026", 512, 92, F_BOLD, 62, INK, "c");
  rect(MX, 102, CW, 1.4, INK);
  rect(MX, 105, CW, 0.7, INK);
}
function drawTimeline(): void {
  const y = 110;
  const h = 22;
  rect(MX, y, CW, h, NAVY);
  let cx = MX + 6;
  rrect(cx, y + 4, 26, 14, 2, GOLD);
  text("UTC", cx + 13, y + 14.5, F_BOLD, 9.5, NAVY_DARK, "c");
  cx += 34;
  TIMELINE.forEach(([t, label], i) => {
    text(t, cx, y + 14.5, F_BOLD, 10.5, GOLD);
    cx += F_BOLD.measure(t, 10.5 * SS) / SS + 5;
    text(label, cx, y + 14.5, F_REG, 10.5, WHITE);
    cx += F_REG.measure(label, 10.5 * SS) / SS + 5;
    if (i < TIMELINE.length - 1) {
      text("·", cx, y + 14.5, F_BOLD, 10.5, [150, 160, 190]);
      cx += 10;
    }
  });
}
function drawLead(s: Story, x: number, y: number, w: number, h: number): void {
  border(x, y, w, h);
  const illH = 104;
  scene(s.scene, x + 1, y + 1, w - 2, illH);
  numBadge(x + 13, y + 13, s.n, 8.5);
  const cw = chipWidth(s.status, 8.5);
  statusChip(x + w - cw - 6, y + illH - 18, s.status, 8.5);
  const tx = x + 8;
  const tw = w - 16;
  text(`${s.n} ${s.loc} — ${s.cat}`, tx, y + illH + 15, F_BOLD, 11, RED);
  const headLines = wrap(s.head, F_BOLD, 19, tw).slice(0, 3);
  headLines.forEach((ln, i) => text(ln, tx, y + illH + 38 + i * 22, F_BOLD, 19, INK));
  const bodyY = y + illH + 38 + headLines.length * 22 + 4;
  const bodyLines = wrap(s.body, F_REG, 10.5, tw);
  const shown = Math.min(bodyLines.length, 5);
  bodyLines.slice(0, shown).forEach((ln, i) => text(ln, tx, bodyY + i * 13, F_REG, 10.5, INK));
  text(s.src, tx, y + h - 8, F_ITAL, 9, INK_SOFT);
}
function drawNumbers(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, CHARCOAL);
  text("THE DAY IN NUMBERS", x + 12, y + 20, F_BOLD, 13, WHITE);
  rect(x + 12, y + 27, w - 24, 1.2, GOLD);
  const rowH = (h - 34) / NUMBERS.length;
  NUMBERS.forEach(([num, cap, col], i) => {
    const ry = y + 34 + i * rowH;
    text(num, x + 12, ry + rowH * 0.52, F_BOLD, 23, col);
    text(cap, x + 12, ry + rowH * 0.52 + 15, F_REG, 10, [226, 220, 204]);
  });
}
function drawGridCard(s: Story, x: number, y: number, w: number, h: number): void {
  border(x, y, w, h);
  const illH = 40;
  scene(s.scene, x + 1, y + 1, w - 2, illH);
  numBadge(x + 11, y + 11, s.n, 7);
  const cw = chipWidth(s.status, 7.5);
  statusChip(x + w - cw - 4, y + illH - 15, s.status, 7.5);
  const tx = x + 6;
  const tw = w - 12;
  text(`${s.n} · ${s.loc} — ${s.cat}`, tx, y + illH + 12, F_BOLD, 9, regionColor(s.region));
  const headLines = wrap(s.head, F_BOLD, 12.5, tw).slice(0, 2);
  headLines.forEach((ln, i) => text(ln, tx, y + illH + 28 + i * 14.5, F_BOLD, 12.5, INK));
  const bodyY = y + illH + 28 + headLines.length * 14.5 + 3;
  const bodyLines = wrap(s.body, F_REG, 9, tw).slice(0, 3);
  bodyLines.forEach((ln, i) => text(ln, tx, bodyY + i * 11, F_REG, 9, INK));
}
function drawWires(y0: number): void {
  text("ALSO ON SUNDAY 22 NOVEMBER — 21 MORE STORIES", MX, y0 + 13, F_BOLD, 13, INK);
  rect(MX, y0 + 18, CW, 1.2, RED);
  const colW = (CW - 2 * 16) / 3;
  const rowH = 16;
  WIRES.forEach(([n, head, tag], i) => {
    const col = Math.floor(i / 7);
    const row = i % 7;
    const x = MX + col * (colW + 16);
    const y = y0 + 24 + row * rowH;
    text(String(n), x, y + 10.5, F_BOLD, 10.5, RED);
    const nx = x + F_BOLD.measure(String(n), 10.5 * SS) / SS + 5;
    text(head, nx, y + 10.5, F_REG, 10, INK);
    const hw = F_REG.measure(head, 10 * SS) / SS;
    const tagW = F_BOLD.measure(tag, 7.5 * SS) / SS;
    if (nx + hw + 6 + tagW <= x + colW) text(tag, nx + hw + 6, y + 10.5, F_BOLD, 7.5, INK_SOFT);
  });
}
function drawBottom(y0: number, h: number): void {
  // Map, left
  const mapX = MX;
  const mapW = 542;
  text("WHERE IT HAPPENED", mapX, y0 + 13, F_BOLD, 13, INK);
  text("pins = story numbers", mapX + mapW, y0 + 12, F_ITAL, 9.5, INK_SOFT, "r");
  rect(mapX, y0 + 18, mapW, 1.2, RED);
  drawMap(mapX, y0 + 22, mapW, h - 22);
  // DATE CHECK, right
  const dcX = MX + mapW + 8;
  const dcW = RX - dcX;
  rect(dcX, y0, dcW, h, CREAM2);
  rect(dcX, y0, dcW, 1.4, RED);
  rect(dcX, y0 + h - 1.4, dcW, 1.4, RED);
  rect(dcX, y0, 1.4, h, RED);
  rect(dcX + dcW - 1.4, y0, 1.4, h, RED);
  const chipW = chip(dcX + 10, y0 + 8, "DATE CHECK", RED, WHITE, 10);
  text("FULL-DAY EDITION", dcX + 10 + chipW + 8, y0 + 18.5, F_BOLD, 11, RED);
  para(DATE_CHECK, dcX + 10, y0 + 54, F_REG, 10.5, 13.5, dcW - 20, INK);
}
function drawFooter(y0: number): void {
  text("Sources: Reuters · CNN · AP · Le Monde · Xinhua · UKMTO · IRIB / Al Jazeera · CBS · European Commission · F1 · France 24 · Finnish Border Guard · wire reports", MX, y0 + 10, F_REG, 9, INK_SOFT);
  text("CERTAINTY: CONFIRMED official / 2+ outlets  ·  CLAIM one side's claim  ·  REPORTED witnesses / one source  ·  PENDING not settled yet", MX, y0 + 22, F_REG, 9, INK_SOFT);
  text("Scenes are drawn illustrations — no photographs.", RX, y0 + 10, F_ITAL, 9, INK_SOFT, "r");
  const y = y0 + 28;
  rect(MX, y, CW, 32, NAVY);
  text("THE WORLD IN ONE DAY", MX + 10, y + 21, F_BOLD, 11, WHITE);
  text("SUNDAY 22 NOVEMBER 2026 · ONE PAGE", RX - 10, y + 21, F_BOLD, 10, GOLD, "r");
}

// ---------------------------------------------------------------- main
function render(): void {
  fillAll(CREAM);
  drawTopBar();
  drawMasthead();
  drawTimeline();
  // leads + numbers column
  const leadY = 136;
  const leadH = 276;
  const leadW = 246;
  LEADS.forEach((s, i) => drawLead(s, MX + i * (leadW + 8), leadY, leadW, leadH));
  drawNumbers(MX + 3 * (leadW + 8) + 8 - 8, leadY, 234, leadH);
  // grid 2 rows x 6
  const gridY = 420;
  const gridH = 119;
  const gridW = (CW - 5 * 8) / 6;
  GRID.forEach((s, i) => {
    const col = i % 6;
    const row = Math.floor(i / 6);
    drawGridCard(s, MX + col * (gridW + 8), gridY + row * gridH, gridW, gridH - 0);
  });
  drawWires(666);
  drawBottom(808, 146);
  drawFooter(956);
}
function main(): void {
  render();
  // downsample 2x -> 1x (box average)
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const o = ((y * SS + dy) * W2 + (x * SS + dx)) * 3;
          r += buf[o];
          g += buf[o + 1];
          b += buf[o + 2];
        }
      }
      const o = (y * W + x) * 3;
      out[o] = Math.round(r / (SS * SS));
      out[o + 1] = Math.round(g / (SS * SS));
      out[o + 2] = Math.round(b / (SS * SS));
    }
  }
  const png = encodePNG(out, W, H);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "entry.png"), png);
}
main();
