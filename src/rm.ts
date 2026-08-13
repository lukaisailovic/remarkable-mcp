import { PNG } from "pngjs";

const V5 = "reMarkable .lines file, version=5          ";
const V6 = "reMarkable .lines file, version=6          ";

export const PAGE_W = 1404;
export const PAGE_H = 1872;

export type Point = { x: number; y: number; width?: number };
export type Line = { tool: number; color: number; points: Point[] };

export type StrokeIn = {
  points: [number, number][];
  tool?: "pen" | "highlighter";
  color?: string;
};

export class RmError extends Error {
  readonly code: string;
  constructor(message: string, code = "unsupported_rm") {
    super(message);
    this.name = "RmError";
    this.code = code;
  }
}

export function parseRm(data: Uint8Array): { version: 5 | 6; lines: Line[] } {
  const head = new TextDecoder().decode(data.subarray(0, 43));
  if (head.startsWith("reMarkable .lines file, version=5")) return { version: 5, lines: readV5(data) };
  if (head.startsWith("reMarkable .lines file, version=6")) return { version: 6, lines: readV6(data) };
  if (data.length === 0) return { version: 5, lines: [] };
  throw new RmError(`unsupported .rm header: ${JSON.stringify(head.slice(0, 40))}`);
}

export function writeV5(lines: Line[]): Uint8Array {
  const parts: Uint8Array[] = [enc(V5)];
  parts.push(u32(lines.length ? 1 : 0));
  if (lines.length) {
    parts.push(u32(lines.length));
    for (const line of lines) {
      parts.push(u32(line.tool), u32(line.color), u32(0), f32(2));
      parts.push(u32(line.points.length));
      for (const p of line.points) {
        parts.push(f32(p.x), f32(p.y), f32(0), f32(0), f32(p.width ?? 2), f32(0.5));
      }
    }
  }
  return concat(parts);
}

export function blankPage(): Uint8Array {
  return writeV5([]);
}

export function appendStrokes(existing: Uint8Array | null, strokes: StrokeIn[]): Uint8Array {
  const parsed = existing?.length ? parseRm(existing) : { version: 5 as const, lines: [] };
  const added = strokes.map(strokeToLine);
  if (parsed.version === 5) return writeV5([...parsed.lines, ...added]);
  return concat([existing ?? enc(V6), ...added.map((line, i) => v6LineItem(line, 101 + i))]);
}

/** Type Folio paragraph styles from the on-device Aa menu. */
export type TextStyle = "title" | "heading" | "body";

const STYLE_CODE: Record<TextStyle, number> = { title: 2, heading: 3, body: 1 };

/** v6 page with native typed text. First line gets `style`; later lines are body. */
export function writeNativeText(text: string, style: TextStyle = "body"): Uint8Array {
  const uuid = new Uint8Array(16);
  crypto.getRandomValues(uuid);
  const lines = text.split("\n").length;
  const code = STYLE_CODE[style];
  const formats: Uint8Array[] = [textFormat(0, 0, 1, 15, code)];
  if (style !== "body") {
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") formats.push(textFormat(1, 16 + i, 1, 16 + i, 1));
    }
  }
  return concat([
    enc(V6),
    blk(0x09, 1, 1, concat([varuint(1n), sub(0, concat([varuint(16n), uuid, u16(1)]))])),
    blk(0x00, 1, 1, concat([tid(1, 1, 1), tbool(2, true), tbool(3, false)])),
    blk(0x0a, 0, 1, concat([tint(1, 1), tint(2, 0), tint(3, text.length + 1), tint(4, lines), tint(5, 0)])),
    blk(0x01, 1, 1, concat([tid(1, 0, 11), tid(2, 0, 0), tbool(3, true), sub(4, tid(1, 0, 1))])),
    blk(
      0x07,
      1,
      1,
      concat([
        tid(1, 0, 0),
        sub(
          2,
          concat([
            sub(1, sub(1, concat([varuint(1n), textItem(text)]))),
            sub(2, sub(1, concat([varuint(BigInt(formats.length)), ...formats]))),
          ]),
        ),
        sub(3, concat([f64(-468), f64(234)])),
        tfloat(4, 936),
      ]),
    ),
    blk(0x02, 1, 1, concat([tid(1, 0, 1), lwwStr(2, 0, 0, ""), lwwBool(3, 0, 0, true)])),
    blk(0x02, 1, 1, concat([tid(1, 0, 11), lwwStr(2, 0, 12, "Layer 1"), lwwBool(3, 0, 0, true)])),
    blk(
      0x04,
      1,
      1,
      concat([tid(1, 0, 1), tid(2, 0, 13), tid(3, 0, 0), tid(4, 0, 0), tint(5, 0), sub(6, concat([u8(2), tid(2, 0, 11)]))]),
    ),
  ]);
}

export function pageWithNativeText(existing: Uint8Array | null, text: string, style: TextStyle): Uint8Array {
  const parsed = existing?.length ? parseRm(existing) : { version: 5 as const, lines: [] };
  const base = writeNativeText(text, style);
  if (!parsed.lines.length) return base;
  return concat([base, ...parsed.lines.map((line, i) => v6LineItem(line, 101 + i))]);
}

export function parseNativeText(data: Uint8Array): { text: string; style: number } | null {
  const head = new TextDecoder().decode(data.subarray(0, 43));
  if (!head.startsWith("reMarkable .lines file, version=6")) return null;
  let o = 43;
  while (o + 8 <= data.length) {
    const len = u32le(data, o);
    const type = data[o + 7] ?? 0;
    const start = o + 8;
    const end = start + len;
    if (end > data.length) break;
    if (type === 0x07) {
      const got = parseRootText(data.subarray(start, end));
      if (got) return got;
    }
    o = end;
  }
  return null;
}

function parseRootText(p: Uint8Array): { text: string; style: number } | null {
  let text = "";
  let style = 1;
  for (let i = 0; i + 6 < p.length; i++) {
    if (p[i] === 0x6c) {
      const n = u32le(p, i + 1);
      const inner = p.subarray(i + 5, i + 5 + n);
      if (inner.length !== n) continue;
      const len = readVar(inner, 0);
      if (inner[len.next] === 1 && Number(len.v) === inner.length - len.next - 1) {
        text += new TextDecoder().decode(inner.subarray(len.next + 1));
      }
    }
    if (p[i] === 0x2c && p[i + 1] === 2 && p[i + 2] === 0 && p[i + 3] === 0 && p[i + 4] === 0 && p[i + 5] === 17) {
      const s = p[i + 6];
      if (s === 1 || s === 2 || s === 3) style = s;
    }
  }
  return text ? { text, style } : null;
}

function cid(a: number, b: number): Uint8Array {
  return concat([u8(a), varuint(BigInt(b))]);
}

function tid(i: number, a: number, b: number): Uint8Array {
  return concat([tag(i, 0x0f), cid(a, b)]);
}

function tbool(i: number, v: boolean): Uint8Array {
  return concat([tag(i, 0x01), u8(v ? 1 : 0)]);
}

function tint(i: number, n: number): Uint8Array {
  return concat([tag(i, 0x04), u32(n)]);
}

function tfloat(i: number, n: number): Uint8Array {
  return concat([tag(i, 0x04), f32(n)]);
}

function sub(i: number, inner: Uint8Array): Uint8Array {
  return concat([tag(i, 0x0c), u32(inner.length), inner]);
}

function blk(type: number, minV: number, curV: number, payload: Uint8Array): Uint8Array {
  return concat([u32(payload.length), u8(0), u8(minV), u8(curV), u8(type), payload]);
}

function str(i: number, s: string): Uint8Array {
  const b = enc(s);
  return sub(i, concat([varuint(BigInt(b.length)), u8(1), b]));
}

function lwwStr(i: number, ta: number, tb: number, s: string): Uint8Array {
  return sub(i, concat([tid(1, ta, tb), str(2, s)]));
}

function lwwBool(i: number, ta: number, tb: number, v: boolean): Uint8Array {
  return sub(i, concat([tid(1, ta, tb), tbool(2, v)]));
}

function textItem(text: string): Uint8Array {
  return sub(0, concat([tid(2, 1, 16), tid(3, 0, 0), tid(4, 0, 0), tint(5, 0), str(6, text)]));
}

function textFormat(ca: number, cb: number, ta: number, tb: number, code: number): Uint8Array {
  return concat([cid(ca, cb), tid(1, ta, tb), sub(2, concat([u8(17), u8(code)]))]);
}

export function strokeToLine(s: StrokeIn): Line {
  const tool = s.tool === "highlighter" ? 5 : 17;
  const color = colorId(s.color);
  return {
    tool,
    color,
    points: s.points.map(([nx, ny]) => ({
      x: nx * PAGE_W,
      y: ny * PAGE_H,
      width: s.tool === "highlighter" ? 18 : 2,
    })),
  };
}

export function linesToSvg(lines: Line[]): string {
  const paths = lines
    .map((line) => {
      if (line.points.length === 0) return "";
      const d = line.points
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(" ");
      const stroke = line.tool === 5 ? "rgba(255,230,0,0.45)" : "#111";
      const width = line.points[0]?.width ?? 2;
      return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .filter(Boolean)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}"><rect width="100%" height="100%" fill="#fbfbfb"/>${paths}</svg>`;
}

export function linesToPng(lines: Line[]): Uint8Array {
  const w = PAGE_W;
  const h = PAGE_H;
  const px = new Uint8Array(w * h * 3);
  px.fill(251);
  for (const line of lines) {
    const [r, g, b] = line.tool === 5 ? [255, 230, 80] : [20, 20, 20];
    for (let i = 1; i < line.points.length; i++) {
      const a = line.points[i - 1];
      const c = line.points[i];
      if (!a || !c) continue;
      drawLine(px, w, h, a.x, a.y, c.x, c.y, r, g, b, Math.max(1, Math.round(a.width ?? 2)));
    }
  }
  return encodePng(w, h, px);
}

export function textToStrokes(text: string, originX: number, originY: number, scale: number): StrokeIn[] {
  const strokes: StrokeIn[] = [];
  let x = originX;
  let y = originY;
  const lh = (7 + 2) * scale;
  const cw = (5 + 1) * scale;
  for (const ch of text.toUpperCase()) {
    if (ch === "\n") {
      x = originX;
      y += lh / PAGE_H;
      continue;
    }
    if (x + cw / PAGE_W > 0.92) {
      x = originX;
      y += lh / PAGE_H;
    }
    const glyph = FONT[ch] ?? FONT["?"] ?? [0, 0, 0, 0, 0, 0, 0];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row] ?? 0;
      let col = 0;
      while (col < 5) {
        if (((bits >> (4 - col)) & 1) === 0) {
          col++;
          continue;
        }
        let end = col;
        while (end < 5 && ((bits >> (4 - end)) & 1) === 1) end++;
        const y0 = y + ((row + 0.5) * scale) / PAGE_H;
        const x0 = x + ((col + 0.1) * scale) / PAGE_W;
        const x1 = x + ((end - 0.1) * scale) / PAGE_W;
        strokes.push({ points: [[x0, y0], [x1, y0]], tool: "pen", color: "black" });
        col = end;
      }
    }
    x += cw / PAGE_W;
  }
  return strokes;
}

export function wrapText(text: string, cols = 42): string {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (next.length > cols) {
        if (line) out.push(line);
        line = w;
      } else line = next;
    }
    out.push(line);
  }
  return out.join("\n");
}

export function maxNormY(lines: Line[]): number {
  let m = 0;
  for (const line of lines) for (const p of line.points) m = Math.max(m, p.y / PAGE_H);
  return m;
}

function readV5(data: Uint8Array): Line[] {
  let o = 43;
  const layers = u32le(data, o);
  o += 4;
  const lines: Line[] = [];
  for (let li = 0; li < layers; li++) {
    const n = u32le(data, o);
    o += 4;
    for (let i = 0; i < n; i++) {
      const tool = u32le(data, o);
      const color = u32le(data, o + 4);
      o += 16;
      const pc = u32le(data, o);
      o += 4;
      const points: Point[] = [];
      for (let p = 0; p < pc; p++) {
        points.push({ x: f32le(data, o), y: f32le(data, o + 4), width: f32le(data, o + 16) });
        o += 24;
      }
      lines.push({ tool, color, points });
    }
  }
  return lines;
}

function readV6(data: Uint8Array): Line[] {
  const lines: Line[] = [];
  let o = 43;
  while (o + 8 <= data.length) {
    const len = u32le(data, o);
    const type = data[o + 7] ?? 0;
    const start = o + 8;
    const end = start + len;
    if (end > data.length) break;
    if (type === 0x05) {
      try {
        const line = parseV6Line(data.subarray(start, end));
        if (line) lines.push(line);
      } catch {
        /* skip malformed line item */
      }
    }
    o = end;
  }
  return lines;
}

function parseV6Line(payload: Uint8Array): Line | null {
  const points: Point[] = [];
  let tool = 17;
  let color = 0;
  let i = 0;
  while (i < payload.length) {
    const tag = readVar(payload, i);
    i = tag.next;
    const index = Number(tag.v >> 4n);
    const t = Number(tag.v & 0xfn);
    if (t === 0x0c) {
      if (i + 4 > payload.length) break;
      const n = u32le(payload, i);
      i += 4;
      const inner = payload.subarray(i, i + n);
      i += n;
      if (index === 6) scanLineValue(inner, (tl, c, pts) => {
        tool = tl;
        color = c;
        points.push(...pts);
      });
    } else if (t === 0x0f) {
      i += 1;
      const id = readVar(payload, i);
      i = id.next;
    } else if (t === 0x04) i += 4;
    else if (t === 0x08) i += 8;
    else if (t === 0x01) i += 1;
    else break;
  }
  return points.length ? { tool, color, points } : null;
}

function scanLineValue(buf: Uint8Array, out: (tool: number, color: number, pts: Point[]) => void): void {
  let i = 0;
  if (buf[0] === 0x03) i = 1;
  let tool = 17;
  let color = 0;
  const pts: Point[] = [];
  while (i < buf.length) {
    const tag = readVar(buf, i);
    i = tag.next;
    const index = Number(tag.v >> 4n);
    const t = Number(tag.v & 0xfn);
    if (t === 0x04) {
      const n = u32le(buf, i);
      i += 4;
      if (index === 1) tool = n;
      if (index === 2) color = n;
    } else if (t === 0x08) i += 8;
    else if (t === 0x0c) {
      const n = u32le(buf, i);
      i += 4;
      const chunk = buf.subarray(i, i + n);
      i += n;
      if (index === 5) {
        for (let p = 0; p + 14 <= chunk.length; p += 14) {
          pts.push({ x: f32le(chunk, p), y: f32le(chunk, p + 4), width: u16le(chunk, p + 10) / 100 });
        }
      }
    } else if (t === 0x01) i += 1;
    else if (t === 0x0f) {
      i += 1;
      i = readVar(buf, i).next;
    } else break;
  }
  out(tool, color, pts);
}

function v6LineItem(line: Line, seq: number): Uint8Array {
  const pts = concat(
    line.points.map((p) =>
      concat([f32(p.x), f32(p.y), u16(0), u16(Math.round((p.width ?? 2) * 100)), u8(0), u8(128)]),
    ),
  );
  const inner = concat([
    u8(3),
    tag(1, 0x04),
    u32(line.tool),
    tag(2, 0x04),
    u32(line.color),
    tag(3, 0x08),
    f64(1),
    tag(5, 0x0c),
    u32(pts.length),
    pts,
  ]);
  const parent = concat([u8(0), varuint(11n)]);
  const item = concat([u8(1), varuint(BigInt(seq))]);
  const zero = concat([u8(0), varuint(0n)]);
  const sub = concat([
    tag(1, 0x0f),
    parent,
    tag(2, 0x0f),
    item,
    tag(3, 0x0f),
    zero,
    tag(4, 0x0f),
    zero,
    tag(5, 0x04),
    u32(0),
    tag(6, 0x0c),
    u32(inner.length),
    inner,
  ]);
  return concat([u32(sub.length), u8(0), u8(2), u8(2), u8(0x05), sub]);
}

function colorId(name?: string): number {
  const n = (name ?? "black").toLowerCase();
  if (n === "gray" || n === "grey") return 1;
  if (n === "white") return 2;
  return 0;
}

function drawLine(
  px: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  width: number,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy)));
  const rad = Math.max(1, Math.ceil(width / 2));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + (dx * s) / steps);
    const y = Math.round(y0 + (dy * s) / steps);
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        if (ox * ox + oy * oy > rad * rad) continue;
        const xx = x + ox;
        const yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = (yy * w + xx) * 3;
        px[i] = r;
        px[i + 1] = g;
        px[i + 2] = b;
      }
    }
  }
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function encodePng(w: number, h: number, rgb: Uint8Array): Uint8Array {
  const png = new PNG({ width: w, height: h });
  for (let i = 0, p = 0; i < w * h; i++, p += 3) {
    const o = i * 4;
    png.data[o] = rgb[p] ?? 0;
    png.data[o + 1] = rgb[p + 1] ?? 0;
    png.data[o + 2] = rgb[p + 2] ?? 0;
    png.data[o + 3] = 255;
  }
  return Uint8Array.from(PNG.sync.write(png));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function u8(n: number): Uint8Array {
  return Uint8Array.of(n & 255);
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function f32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, n, true);
  return b;
}

function f64(n: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return b;
}

function u32le(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 4).getUint32(0, true);
}

function u16le(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 2).getUint16(0, true);
}

function f32le(b: Uint8Array, o: number): number {
  return new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, true);
}

function varuint(v: bigint): Uint8Array {
  const out: number[] = [];
  while (v > 0x7fn) {
    out.push(Number((v & 0x7fn) | 0x80n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Uint8Array.from(out);
}

function readVar(b: Uint8Array, i: number): { v: bigint; next: number } {
  let v = 0n;
  let shift = 0n;
  while (i < b.length) {
    const byte = b[i] ?? 0;
    i++;
    v |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { v, next: i };
}

function tag(index: number, t: number): Uint8Array {
  return varuint((BigInt(index) << 4n) | BigInt(t));
}

// 5x7 glyphs, bit4 = leftmost pixel. ponytail: uppercase only.
const FONT: Record<string, number[]> = {
  " ": [0, 0, 0, 0, 0, 0, 0],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0e],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0e, 0x11, 0x10, 0x0e, 0x01, 0x11, 0x0e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ".": [0, 0, 0, 0, 0, 0x04, 0x04],
  ",": [0, 0, 0, 0, 0x04, 0x04, 0x08],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x06, 0x04, 0, 0x04],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  ":": [0, 0x04, 0x04, 0, 0x04, 0x04, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
};
