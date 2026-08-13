import { describe, expect, it } from "vitest";
import { extractEpubText, extractPdfText, makeEpub, makePdf } from "../src/pdf.js";

describe("pdf/epub text", () => {
  it("extracts literal strings from a PDF produced by makePdf", async () => {
    const pdf = makePdf("Hello reMarkable");
    expect(new TextDecoder().decode(pdf).startsWith("%PDF")).toBe(true);
    expect(await extractPdfText(pdf)).toContain("Hello reMarkable");
  });

  it("extracts HTML text from a ZIP EPUB produced by makeEpub", async () => {
    const epub = await makeEpub("Notes", "<p>Agenda item one</p>");
    expect(epub[0]).toBe(0x50);
    expect(epub[1]).toBe(0x4b);
    expect(await extractEpubText(epub)).toContain("Agenda item one");
  });
});
