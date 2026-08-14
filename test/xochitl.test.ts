import { describe, expect, it } from "vitest";
import {
  decodeJson,
  defaultMetadata,
  docTags,
  encodeJson,
  idxBetween,
  idxValue,
  isTrash,
  notebookContent,
  pageIds,
  setPageIds,
  touch,
} from "../src/xochitl.js";

describe("xochitl parse/write", () => {
  it("round-trips metadata JSON through the shipped encoder", () => {
    const meta = defaultMetadata("Meeting Notes", "DocumentType", "");
    const again = decodeJson<typeof meta>(encodeJson(meta));
    expect(again.visibleName).toBe("Meeting Notes");
    expect(again.type).toBe("DocumentType");
    expect(again.deleted).toBe(false);
    expect(again.parent).toBe("");
  });

  it("reads page ids from cPages and the legacy pages array", () => {
    const modern = notebookContent(["aaa", "bbb"]);
    expect(pageIds(modern)).toEqual(["aaa", "bbb"]);
    expect(modern.pageCount).toBe(2);
    expect(pageIds({ fileType: "notebook", pageCount: 1, pages: ["legacy"] })).toEqual(["legacy"]);
  });

  it("inserts pages while keeping existing cPages entries", () => {
    const c = notebookContent(["a"]);
    setPageIds(c, ["a", "b"]);
    expect(pageIds(c)).toEqual(["a", "b"]);
    expect(c.cPages?.pages[0]?.id).toBe("a");
    expect(c.cPages?.pages[0]?.idx?.value).toBe("ba");
    expect(c.cPages?.pages[1]?.idx?.value).toBe("bb");
    expect(c.pageCount).toBe(2);
  });

  it("assigns an idx that sorts after a stock firmware page", () => {
    const c = notebookContent(["old"]);
    c.cPages!.pages[0]!.idx = { timestamp: "1:2", value: "ba" };
    setPageIds(c, ["old", "new"]);
    expect(c.cPages?.pages[1]?.idx?.value).toBe("bb");
    expect(c.cPages!.pages[0]!.idx!.value! < c.cPages!.pages[1]!.idx!.value!).toBe(true);
  });

  it("assigns an idx between neighbors on mid-insert", () => {
    const c = notebookContent(["a", "c"]);
    setPageIds(c, ["a", "b", "c"]);
    const idx = c.cPages?.pages.map((p) => p.idx?.value);
    expect(idx).toEqual(["ba", "baa", "bb"]);
    expect(idxBetween("ba", "bb")).toBe("baa");
  });

  it("treats trash parent and deleted flag as trashed", () => {
    const a = defaultMetadata("gone", "DocumentType", "trash");
    expect(isTrash(a)).toBe(true);
    const b = defaultMetadata("x", "DocumentType");
    b.deleted = true;
    expect(isTrash(b)).toBe(true);
    expect(isTrash(defaultMetadata("live", "DocumentType"))).toBe(false);
  });

  it("unions metadata and content tags", () => {
    const meta = defaultMetadata("n", "DocumentType");
    meta.tags = [{ name: "work", timestamp: "1:1" }];
    const content = notebookContent(["p"]);
    content.tags = [
      { name: "work", timestamp: "1:1" },
      { name: "urgent", timestamp: "1:2" },
    ];
    expect(docTags(meta, content).sort()).toEqual(["urgent", "work"]);
  });

  it("bumps version and lastModified on touch", () => {
    const meta = defaultMetadata("n", "DocumentType");
    const v = meta.version;
    const t = meta.lastModified;
    touch(meta);
    expect(meta.version).toBe(v + 1);
    expect(Number(meta.lastModified)).toBeGreaterThanOrEqual(Number(t));
  });

  it("encodes firmware-style page idx values", () => {
    expect(idxValue(0)).toBe("ba");
    expect(idxValue(1)).toBe("bb");
    expect(idxValue(25)).toBe("bz");
    expect(idxValue(26)).toBe("bza");
    expect(idxBetween("ba")).toBe("bb");
    expect(idxBetween(undefined, "ba")).toBe("aa");
  });
});
