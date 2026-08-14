import { renderMermaidSVG } from "beautiful-mermaid";
import { PAGE_H, PAGE_W, textToStrokes, type StrokeIn } from "./rm.js";

/** Mermaid → SVG (beautiful-mermaid) → ink strokes in 0–1 page space. */
export function mermaidToStrokes(src: string): StrokeIn[] {
  const text = unwrap(src);
  if (!text) throw new Error("mermaid source is empty");
  let svg: string;
  try {
    svg = renderMermaidSVG(text, { bg: "#ffffff", fg: "#111111", padding: 16 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`unsupported mermaid: ${msg}`);
  }
  return svgToStrokes(svg);
}

export function svgToStrokes(svg: string): StrokeIn[] {
  const vb = svg
    .match(/viewBox="([^"]+)"/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const x0 = vb?.[0] ?? 0;
  const y0 = vb?.[1] ?? 0;
  const vw = vb?.[2] || Number(svg.match(/\bwidth="([\d.]+)"/)?.[1]) || 1;
  const vh = vb?.[3] || Number(svg.match(/\bheight="([\d.]+)"/)?.[1]) || 1;
  const pad = 0.05;
  const s = Math.min((1 - 2 * pad) / vw, (1 - 2 * pad) / vh);
  const ox = (1 - vw * s) / 2 - x0 * s;
  const oy = pad - y0 * s;
  const nx = (x: number) => ox + x * s;
  const ny = (y: number) => oy + y * s;
  const map = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [nx(x), ny(y)]);
  const strokes: StrokeIn[] = [];
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const add = (pts: [number, number][]) => {
    if (pts.length >= 2) strokes.push({ points: map(pts), tool: "pen", color: "black" });
  };

  for (const tag of tags(svg, "rect")) {
    const x = num(tag, "x");
    const y = num(tag, "y");
    const w = num(tag, "width");
    const h = num(tag, "height");
    if (w <= 0 || h <= 0) continue;
    add([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y],
    ]);
    boxes.push({ x0: nx(x), y0: ny(y), x1: nx(x + w), y1: ny(y + h) });
  }
  for (const tag of tags(svg, "circle")) {
    const cx = num(tag, "cx");
    const cy = num(tag, "cy");
    const r = num(tag, "r");
    if (r <= 0) continue;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    add(pts);
  }
  for (const tag of tags(svg, "line")) {
    add([
      [num(tag, "x1"), num(tag, "y1")],
      [num(tag, "x2"), num(tag, "y2")],
    ]);
    if (/\bmarker-end=/.test(tag))
      add(
        arrow([
          [num(tag, "x1"), num(tag, "y1")],
          [num(tag, "x2"), num(tag, "y2")],
        ]),
      );
  }
  for (const tag of tags(svg, "polyline")) {
    const pts = parsePts(attr(tag, "points"));
    add(pts);
    if (/\bmarker-end=/.test(tag)) add(arrow(pts));
    if (/\bmarker-start=/.test(tag)) add(arrow([...pts].reverse()));
  }
  for (const tag of tags(svg, "polygon")) {
    const pts = parsePts(attr(tag, "points"));
    if (pts[0] && pts.at(-1) && (pts[0][0] !== pts.at(-1)![0] || pts[0][1] !== pts.at(-1)![1]))
      pts.push(pts[0]);
    add(pts);
  }
  for (const tag of tags(svg, "path")) {
    if (/\bshadow\b/.test(tag)) continue;
    for (const line of pathToLines(attr(tag, "d") ?? "")) add(line);
  }
  const labels: { raw: string; cx: number; cy: number; maxW: number; fs: number }[] = [];
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const raw = decode((m[2] ?? "").replace(/<[^>]+>/g, "")).trim();
    if (!raw) continue;
    const tag = m[1] ?? "";
    const px = nx(num(tag, "x"));
    const py = ny(num(tag, "y") + num(tag, "dy"));
    const box =
      boxes.find((b) => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) ??
      boxes.toSorted(
        (a, b) =>
          (a.x0 + a.x1 - 2 * px) ** 2 +
          (a.y0 + a.y1 - 2 * py) ** 2 -
          ((b.x0 + b.x1 - 2 * px) ** 2 + (b.y0 + b.y1 - 2 * py) ** 2),
      )[0];
    labels.push({
      raw,
      cx: box ? (box.x0 + box.x1) / 2 : px,
      cy: box ? (box.y0 + box.y1) / 2 : py,
      maxW: box ? (box.x1 - box.x0) * 0.86 * PAGE_W : Infinity,
      fs: num(tag, "font-size") || 13,
    });
  }
  let scale = Infinity;
  for (const lab of labels) {
    scale = Math.min(
      scale,
      (lab.fs * s * PAGE_H) / 7,
      lab.maxW / (Math.max(1, lab.raw.length) * 6),
    );
  }
  if (!Number.isFinite(scale) || scale < 1.6) scale = 1.6;
  for (const lab of labels) {
    const tw = (lab.raw.length * 6 * scale) / PAGE_W;
    const th = (7 * scale) / PAGE_H;
    strokes.push(...textToStrokes(lab.raw, lab.cx - tw / 2, lab.cy - th / 2, scale));
  }
  if (!strokes.length) throw new Error("mermaid produced no drawable shapes");
  return strokes;
}

function unwrap(src: string): string {
  const t = src.trim();
  const fenced = t.match(/^```(?:mermaid)?\s*\n([\s\S]*?)```$/);
  return (fenced?.[1] ?? t).trim();
}

function tags(svg: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}\\b([^>]*?)/?>`, "gi");
  for (const m of svg.matchAll(re)) out.push(m[1] ?? "");
  return out;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1];
}

function num(tag: string, name: string): number {
  const v = Number(attr(tag, name));
  return Number.isFinite(v) ? v : 0;
}

function parsePts(s: string | undefined): [number, number][] {
  const n = (s ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((v) => Number.isFinite(v));
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i]!, n[i + 1]!]);
  return pts;
}

function arrow(pts: [number, number][]): [number, number][] {
  const a = pts.at(-2);
  const b = pts.at(-1);
  if (!a || !b) return [];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const sz = 6;
  return [
    [b[0] - ux * sz + -uy * sz * 0.45, b[1] - uy * sz + ux * sz * 0.45],
    b,
    [b[0] - ux * sz - -uy * sz * 0.45, b[1] - uy * sz - ux * sz * 0.45],
  ];
}

// ponytail: sample M/L/H/V/C/Q/Z only; add arcs if mermaid starts emitting them
function pathToLines(d: string): [number, number][][] {
  const tok = d.match(/[MmLlHhVvCcQqTtSsAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const lines: [number, number][][] = [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cur: [number, number][] = [];
  const flush = () => {
    if (cur.length >= 2) lines.push(cur);
    cur = [];
  };
  const push = (px: number, py: number) => {
    x = px;
    y = py;
    cur.push([x, y]);
  };
  const next = (): number => Number(tok[i++] ?? 0);
  while (i < tok.length) {
    const c = tok[i++] ?? "";
    if (c === "Z" || c === "z") {
      push(sx, sy);
      flush();
      continue;
    }
    const rel = c === c.toLowerCase();
    const cmd = c.toUpperCase();
    if (cmd === "M") {
      flush();
      push(rel ? x + next() : next(), rel ? y + next() : next());
      sx = x;
      sy = y;
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) {
        push(rel ? x + next() : next(), rel ? y + next() : next());
      }
    } else if (cmd === "L") {
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) {
        push(rel ? x + next() : next(), rel ? y + next() : next());
      }
    } else if (cmd === "H") {
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) push(rel ? x + next() : next(), y);
    } else if (cmd === "V") {
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) push(x, rel ? y + next() : next());
    } else if (cmd === "C") {
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) {
        const x1 = rel ? x + next() : next();
        const y1 = rel ? y + next() : next();
        const x2 = rel ? x + next() : next();
        const y2 = rel ? y + next() : next();
        const x3 = rel ? x + next() : next();
        const y3 = rel ? y + next() : next();
        sample(cur, x, y, x1, y1, x2, y2, x3, y3);
        x = x3;
        y = y3;
      }
    } else if (cmd === "Q") {
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) {
        const x1 = rel ? x + next() : next();
        const y1 = rel ? y + next() : next();
        const x2 = rel ? x + next() : next();
        const y2 = rel ? y + next() : next();
        sampleQ(cur, x, y, x1, y1, x2, y2);
        x = x2;
        y = y2;
      }
    } else if (cmd === "A" || cmd === "S" || cmd === "T") {
      // skip unused extras; consume numbers so the scanner stays aligned
      while (i < tok.length && !/^[A-Za-z]$/.test(tok[i] ?? "")) i++;
    }
  }
  flush();
  return lines;
}

function sample(
  cur: [number, number][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
): void {
  for (let i = 1; i <= 8; i++) {
    const t = i / 8;
    const u = 1 - t;
    cur.push([
      u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
      u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
    ]);
  }
}

function sampleQ(
  cur: [number, number][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const u = 1 - t;
    cur.push([u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2]);
  }
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
