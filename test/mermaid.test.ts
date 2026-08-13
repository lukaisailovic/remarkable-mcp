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
    const strokes = mermaidToStrokes("```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n  Bob-->>Alice: Hi\n```");
    expect(strokes.length).toBeGreaterThan(6);
  });

  it("rejects pie and empty source", () => {
    expect(() => mermaidToStrokes("pie title Pets\n  \"Dogs\" : 1")).toThrow(/unsupported mermaid/i);
    expect(() => mermaidToStrokes("   ")).toThrow(/empty/);
  });

  it("samples SVG path bars", () => {
    const strokes = svgToStrokes(
      `<svg viewBox="0 0 100 100"><path d="M10,10 L90,10 L90,90 L10,90 Z"/></svg>`,
    );
    expect(strokes[0]?.points.length).toBeGreaterThanOrEqual(4);
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
