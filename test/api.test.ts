import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import { MemoryFs } from "../src/fs.js";
import { makeEpub, makePdf } from "../src/pdf.js";
import { parseRm } from "../src/rm.js";

function api() {
  const fs = new MemoryFs();
  return { fs, rm: createApi(fs) };
}

describe("library / write / notebook API", () => {
  it("lists, hides trash, and browse/search by name and tag", async () => {
    const { rm } = api();
    const folder = await rm.mkdir({ name: "Work" });
    const note = await rm.createNotebook({ name: "Standup", parent: folder.id });
    await rm.tag({ notebook: note.id, tag: "work" });
    await rm.createNotebook({ name: "Old Draft" });
    await rm.remove({ notebook: "Old Draft" });

    const visible = await rm.list({});
    expect(visible.map((i) => i.name).sort()).toEqual(["Standup", "Work"]);
    expect(visible.find((i) => i.name === "Old Draft")).toBeUndefined();

    const all = await rm.list({ includeTrash: true });
    expect(all.some((i) => i.name === "Old Draft" && i.trashed)).toBe(true);

    const inWork = await rm.browse({ path: "/Work" });
    expect(inWork.map((i) => i.name)).toEqual(["Standup"]);

    const found = await rm.search({ query: "stand", tag: "work" });
    expect(found).toHaveLength(1);
    expect(found[0]?.path).toBe("/Work/Standup");

    const info = await rm.info({ notebook: "/Work/Standup" });
    expect(info.id).toBe(note.id);
    expect(info.tags).toContain("work");
  });

  it("uploads, reads, and downloads PDF/EPUB bytes", async () => {
    const { rm } = api();
    const pdf = makePdf("Quarterly results");
    const uploaded = await rm.upload({
      name: "Q1.pdf",
      dataBase64: Buffer.from(pdf).toString("base64"),
    });
    expect(uploaded.fileType).toBe("pdf");
    expect((await rm.read({ notebook: "Q1" })).text).toContain("Quarterly results");
    const raw = await rm.download({ notebook: uploaded.id });
    expect(raw.mime).toBe("application/pdf");
    expect(Buffer.from(raw.base64, "base64").equals(Buffer.from(pdf))).toBe(true);

    const epub = await makeEpub("Book", "<p>Chapter text here</p>");
    await rm.upload({
      name: "Book.epub",
      dataBase64: Buffer.from(epub).toString("base64"),
      fileType: "epub",
    });
    expect((await rm.read({ notebook: "Book" })).text).toContain("Chapter text here");
  });

  it("mkdir/move/rename/delete and restarts xochitl after writes", async () => {
    const { fs, rm } = api();
    await rm.mkdir({ name: "Inbox" });
    const doc = await rm.createNotebook({ name: "Scratch" });
    await rm.move({ notebook: "Scratch", folder: "Inbox" });
    await rm.rename({ notebook: doc.id, name: "Kept" });
    const after = await rm.list({});
    expect(after.find((i) => i.id === doc.id)?.path).toBe("/Inbox/Kept");
    await rm.remove({ notebook: "Kept" });
    expect((await rm.list({})).find((i) => i.id === doc.id)).toBeUndefined();
    expect(fs.cmds.some((c) => c.includes("systemctl restart xochitl"))).toBe(true);
    expect((await rm.refresh()).restarted).toBe(true);
  });

  it("creates notebooks, adds/removes pages, writes ink and text, exports PNG/SVG", async () => {
    const { fs, rm } = api();
    const nb = await rm.createNotebook({ name: "Ideas" });
    expect(nb.pageCount).toBe(1);
    await rm.addPage({ notebook: nb.id });
    expect((await rm.info({ notebook: nb.id })).pageCount).toBe(2);
    await rm.writeInk({
      notebook: nb.id,
      page: 1,
      strokes: [{ points: [[0.1, 0.1], [0.9, 0.1]], tool: "highlighter", color: "yellow" }],
    });
    await rm.writeText({ notebook: nb.id, page: 1, text: "hello" });
    const svg = await rm.exportPage({ notebook: nb.id, page: 1, format: "svg" });
    expect(svg.mime).toBe("image/svg+xml");
    const svgText = Buffer.from(svg.base64, "base64").toString();
    expect(svgText).toContain("<path");
    const png = await rm.exportPage({ notebook: nb.id, page: 1, format: "png" });
    expect(png.mime).toBe("image/png");
    expect(Buffer.from(png.base64, "base64").subarray(0, 4).toString()).toContain("PNG");

    const pageFiles = [...fs.files.keys()].filter((k) => k.endsWith(".rm"));
    expect(pageFiles.length).toBeGreaterThanOrEqual(2);
    const firstRm = fs.files.get(pageFiles[0] ?? "");
    expect(firstRm && parseRm(firstRm).lines.length).toBe(1);

    await rm.removePage({ notebook: nb.id, page: 2 });
    expect((await rm.info({ notebook: nb.id })).pageCount).toBe(1);
  });

  it("stacks native title, body, and checkbox writes and reads them back", async () => {
    const { rm } = api();
    await rm.createNotebook({ name: "Journal" });
    const created = await rm.writeText({
      notebook: "Journal",
      newPage: true,
      blocks: [
        { text: "Monday", style: "title" },
        { text: "Walked the dog", style: "body" },
      ],
    });
    expect(created.page).toBe(2);
    await rm.writeText({ notebook: "Journal", page: 2, text: "Buy milk\nBuy eggs", style: "checkbox" });
    await rm.writeText({ notebook: "Journal", page: 2, text: "Stretched", style: "checkbox", checked: true });

    const got = await rm.read({ notebook: "Journal", page: 2 });
    expect(got.fileType).toBe("notebook");
    expect(got.paragraphs?.map((p) => [p.style, p.text, p.checked ?? null])).toEqual([
      ["title", "Monday", null],
      ["body", "Walked the dog", null],
      ["checkbox", "Buy milk", false],
      ["checkbox", "Buy eggs", false],
      ["checkbox", "Stretched", true],
    ]);

    const info = await rm.info({ notebook: "Journal" });
    expect(info.type).toBe("notebook");
    expect(info.pages?.[1]?.title).toBe("Monday");

    await rm.writeText({ notebook: "Journal", page: 2, text: "Only this", style: "heading", replace: true });
    expect((await rm.read({ notebook: "Journal", page: 2 })).text).toBe("Only this");
  });

  it("adds and removes tags including listing every tag", async () => {
    const { rm } = api();
    await rm.createNotebook({ name: "Tagged" });
    await rm.tag({ notebook: "Tagged", tag: "personal" });
    expect(await rm.tags()).toEqual(["personal"]);
    await rm.tag({ notebook: "Tagged", tag: "personal", remove: true });
    expect(await rm.tags()).toEqual([]);
  });
});
