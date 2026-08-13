import { describe, expect, it } from "vitest";
import {
  appendStrokes,
  blankPage,
  linesToPng,
  linesToSvg,
  pageWithNativeText,
  parseNativeText,
  parseRm,
  textToStrokes,
  writeNativeText,
  writeV5,
  type Line,
} from "../src/rm.js";

const stroke = (points: [number, number][]) => ({ points, tool: "pen" as const, color: "black" });

describe("rm parse/write", () => {
  it("round-trips v5 strokes through writeV5 and parseRm", () => {
    const lines: Line[] = [
      {
        tool: 17,
        color: 0,
        points: [
          { x: 10, y: 20, width: 2 },
          { x: 100, y: 80, width: 2 },
        ],
      },
    ];
    const raw = writeV5(lines);
    const parsed = parseRm(raw);
    expect(parsed.version).toBe(5);
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]?.points[0]?.x).toBeCloseTo(10, 2);
    expect(parsed.lines[0]?.points[1]?.y).toBeCloseTo(80, 2);
  });

  it("appends strokes onto a blank page and SVG includes the ink", () => {
    const raw = appendStrokes(blankPage(), [stroke([[0.1, 0.2], [0.8, 0.2]])]);
    const { lines } = parseRm(raw);
    const svg = linesToSvg(lines);
    expect(svg).toContain("<svg");
    expect(svg).toContain("path");
    expect(svg).toContain("140.4");
  });

  it("encodes a real PNG whose pixels are not blank paper", () => {
    const { lines } = parseRm(appendStrokes(null, [stroke([[0.2, 0.3], [0.7, 0.6]])]));
    const png = linesToPng(lines);
    expect(png[0]).toBe(137);
    expect(String.fromCharCode(...png.subarray(1, 4))).toBe("PNG");
    expect(png.length).toBeGreaterThan(800);
  });

  it("turns text into strokes that survive parse", () => {
    const strokes = textToStrokes("HI", 0.1, 0.1, 3);
    expect(strokes.length).toBeGreaterThan(4);
    const { lines } = parseRm(appendStrokes(blankPage(), strokes));
    expect(lines.length).toBe(strokes.length);
  });

  it("rejects unknown .rm headers with a structured error", () => {
    expect(() => parseRm(new TextEncoder().encode("not a remarkable file!!!!!!!!!!!!!!"))).toThrow(/unsupported/);
  });

  it("writes native Type Folio title text that parseNativeText reads back", () => {
    const raw = writeNativeText("Monday", "title");
    expect(new TextDecoder().decode(raw.subarray(0, 43))).toContain("version=6");
    const got = parseNativeText(raw);
    expect(got?.text).toBe("Monday");
    expect(got?.style).toBe(2);
    const withInk = pageWithNativeText(appendStrokes(blankPage(), [stroke([[0.1, 0.1], [0.2, 0.2]])]), "Hi", "body");
    expect(parseNativeText(withInk)?.text).toBe("Hi");
    expect(parseRm(withInk).lines.length).toBe(1);
  });

  it("appends line items onto a v6 header and parseRm reads them", () => {
    const header = new TextEncoder().encode("reMarkable .lines file, version=6          ");
    const raw = appendStrokes(header, [{ points: [[0.1, 0.1], [0.2, 0.2]], tool: "pen" }]);
    const parsed = parseRm(raw);
    expect(parsed.version).toBe(6);
    expect(parsed.lines.length).toBe(1);
    expect(parsed.lines[0]?.points[0]?.x).toBeCloseTo(140.4, 0);
  });
});
