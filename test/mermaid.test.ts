import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import { MemoryFs } from "../src/fs.js";
import { mermaidToStrokes, svgToStrokes } from "../src/mermaid.js";

const flow = `flowchart TD
  A[Start] --> B{Is it?}
  B -->|Yes| C[Do it]
  B -->|No| D[Skip]
`;

describe("mermaid → ink", () => {
  it("turns a flowchart into in-page strokes", () => {
    const strokes = mermaidToStrokes(flow);
    expect(strokes.length).toBeGreaterThan(10);
    for (const s of strokes) {
      expect(s.points.length).toBeGreaterThanOrEqual(2);
      for (const [x, y] of s.points) {
        expect(x).toBeGreaterThanOrEqual(-0.05);
        expect(x).toBeLessThanOrEqual(1.05);
        expect(y).toBeGreaterThanOrEqual(-0.05);
        expect(y).toBeLessThanOrEqual(1.05);
      }
    }
    const ys = strokes.flatMap((s) => s.points.map((p) => p[1]));
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.2);
  });

  it("accepts a fenced sequenceDiagram", () => {
    const strokes = mermaidToStrokes(
      "```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```",
    );
    expect(strokes.length).toBeGreaterThan(6);
  });

  it("rejects pie and empty source", () => {
    expect(() => mermaidToStrokes('pie title Pets\n  "Dogs" : 1')).toThrow(/unsupported mermaid/i);
    expect(() => mermaidToStrokes("   ")).toThrow(/empty/);
  });

  it("samples SVG path bars", () => {
    const strokes = svgToStrokes(
      `<svg viewBox="0 0 100 100"><path d="M10,10 L90,10 L90,90 L10,90 Z"/></svg>`,
    );
    expect(strokes[0]?.points.length).toBeGreaterThanOrEqual(4);
  });

  it("centers flowchart labels inside their boxes", () => {
    const src = "flowchart LR\n  A[MCP] --> B[rmfakecloud]\n  B --> C[Tablet]";
    const strokes = mermaidToStrokes(src);
    const boxes = strokes.filter((s) => s.points.length === 5);
    expect(boxes.length).toBe(3);
    const heights: number[] = [];
    for (const box of boxes) {
      const x0 = Math.min(...box.points.map((p) => p[0]));
      const x1 = Math.max(...box.points.map((p) => p[0]));
      const y0 = Math.min(...box.points.map((p) => p[1]));
      const y1 = Math.max(...box.points.map((p) => p[1]));
      const hits = strokes.filter((s) => {
        if (s.points.length !== 2) return false;
        const mx = (s.points[0]![0] + s.points[1]![0]) / 2;
        const my = (s.points[0]![1] + s.points[1]![1]) / 2;
        return mx > x0 && mx < x1 && my > y0 && my < y1;
      });
      expect(hits.length).toBeGreaterThan(4);
      const hxs = hits.flatMap((s) => s.points.map((p) => p[0]));
      const hys = hits.flatMap((s) => s.points.map((p) => p[1]));
      const tcx = (Math.min(...hxs) + Math.max(...hxs)) / 2;
      const tcy = (Math.min(...hys) + Math.max(...hys)) / 2;
      expect(tcx).toBeCloseTo((x0 + x1) / 2, 1);
      expect(tcy).toBeCloseTo((y0 + y1) / 2, 1);
      heights.push(Math.max(...hys) - Math.min(...hys));
    }
    expect(Math.max(...heights) / Math.min(...heights)).toBeLessThan(1.35);
  });

  it("writes a notebook page and export includes the ink", async () => {
    const rm = createApi(new MemoryFs());
    await rm.createNotebook({ name: "Charts" });
    const wrote = await rm.writeMermaid({ notebook: "Charts", mermaid: flow });
    expect(wrote.page).toBe(1);
    const svg = await rm.exportPage({ notebook: "Charts", page: 1, format: "svg" });
    expect(Buffer.from(svg.base64, "base64").toString()).toContain("<path");
  });
});
