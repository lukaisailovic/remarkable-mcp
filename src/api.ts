import type { TabletFs } from "./fs.js";
import { extractEpubText, extractPdfText } from "./pdf.js";
import { mermaidToStrokes } from "./mermaid.js";
import {
  appendStrokes,
  blankPage,
  linesToPng,
  linesToSvg,
  linesToParas,
  pageWithNativeText,
  parseNativeText,
  parseRm,
  type NativePara,
  type StrokeIn,
  type TextStyle,
} from "./rm.js";
import {
  decodeJson,
  defaultMetadata,
  docTags,
  encodeJson,
  fileContent,
  folderContent,
  isTrash,
  notebookContent,
  pageIds,
  setPageIds,
  touch,
  type Content,
  type Metadata,
  type Tag,
} from "./xochitl.js";

export type Item = {
  id: string;
  name: string;
  type: "notebook" | "folder" | "pdf" | "epub";
  fileType: string;
  parent: string;
  path: string;
  pageCount: number;
  tags: string[];
  lastModified: string;
  trashed: boolean;
  page?: number;
  pages?: { page: number; title: string }[];
};

export type PageText = {
  fileType: string;
  page?: number;
  text: string;
  paragraphs?: NativePara[];
  pages?: PageText[];
};

export type Remarkable = ReturnType<typeof createApi>;

type Rec = { id: string; meta: Metadata; content?: Content };

export function createApi(fs: TabletFs) {
  const load = async (): Promise<Rec[]> => {
    const recs: Rec[] = [];
    for (const e of await fs.readdir("")) {
      if (!e.name.endsWith(".metadata")) continue;
      const id = e.name.slice(0, -".metadata".length);
      const meta = decodeJson<Metadata>(await fs.readFile(e.name));
      let content: Content | undefined;
      if (await fs.exists(`${id}.content`)) {
        try {
          content = decodeJson<Content>(await fs.readFile(`${id}.content`));
        } catch {
          content = undefined;
        }
      }
      recs.push({ id, meta, content });
    }
    return recs;
  };

  const paths = (recs: Rec[]): Map<string, string> => {
    const byId = new Map(recs.map((r) => [r.id, r]));
    const cache = new Map<string, string>();
    const walk = (id: string, seen = new Set<string>()): string => {
      const hit = cache.get(id);
      if (hit) return hit;
      if (seen.has(id)) return `/${id}`;
      seen.add(id);
      const rec = byId.get(id);
      if (!rec) return `/${id}`;
      const parent = rec.meta.parent;
      const name = rec.meta.visibleName;
      const p =
        !parent || parent === "trash"
          ? `/${name}`
          : `${walk(parent, seen)}/${name}`;
      cache.set(id, p);
      return p;
    };
    for (const r of recs) walk(r.id);
    return cache;
  };

  const kind = (r: Rec): Item["type"] => {
    if (r.meta.type === "CollectionType") return "folder";
    const ft = r.content?.fileType ?? "";
    if (ft === "pdf" || ft === "epub") return ft;
    return "notebook";
  };

  const view = (r: Rec, pathMap: Map<string, string>): Item => ({
    id: r.id,
    name: r.meta.visibleName,
    type: kind(r),
    fileType: r.content?.fileType ?? "",
    parent: r.meta.parent,
    path: pathMap.get(r.id) ?? `/${r.meta.visibleName}`,
    pageCount: r.content?.pageCount ?? pageIds(r.content ?? folderContent()).length,
    tags: docTags(r.meta, r.content),
    lastModified: r.meta.lastModified,
    trashed: isTrash(r.meta),
  });

  const resolve = async (ref: string, recs = load()): Promise<Rec> => {
    const all = await recs;
    const pathMap = paths(all);
    const exactId = all.find((r) => r.id === ref);
    if (exactId) return exactId;
    const want = ref.startsWith("/") ? ref : `/${ref}`;
    const byPath = all.find((r) => pathMap.get(r.id) === want);
    if (byPath) return byPath;
    const live = all.filter((r) => !isTrash(r.meta));
    const names = live.filter((r) => r.meta.visibleName === ref);
    if (names.length === 1 && names[0]) return names[0];
    if (names.length > 1) throw new Error(`ambiguous name: ${ref}`);
    const ci = live.filter((r) => r.meta.visibleName.toLowerCase() === ref.toLowerCase());
    if (ci.length === 1 && ci[0]) return ci[0];
    throw new Error(`not found: ${ref}`);
  };

  const resolveFolder = async (ref: string | undefined, recs: Rec[]): Promise<string> => {
    if (!ref || ref === "/" || ref === "") return "";
    const rec = await resolve(ref, Promise.resolve(recs));
    if (rec.meta.type !== "CollectionType") throw new Error(`not a folder: ${ref}`);
    return rec.id;
  };

  const saveMeta = async (id: string, meta: Metadata): Promise<void> => {
    await fs.writeFile(`${id}.metadata`, encodeJson(meta));
  };

  const saveContent = async (id: string, content: Content): Promise<void> => {
    await fs.writeFile(`${id}.content`, encodeJson(content));
  };

  const restart = async (): Promise<void> => {
    try {
      await fs.exec("systemctl restart xochitl");
    } catch {
      /* fake / missing systemd */
    }
  };

  const afterWrite = async (r: Rec): Promise<Item> => {
    await restart();
    return view(r, paths(await load()));
  };

  const list = async (opts: { includeTrash?: boolean; folder?: string } = {}): Promise<Item[]> => {
    const recs = await load();
    const pathMap = paths(recs);
    let items = recs.map((r) => view(r, pathMap));
    if (!opts.includeTrash) items = items.filter((i) => !i.trashed);
    if (opts.folder !== undefined) {
      const pid = await resolveFolder(opts.folder, recs);
      items = items.filter((i) => i.parent === pid);
    }
    items.sort((a, b) => a.path.localeCompare(b.path));
    return items;
  };

  const browse = async (opts: { path?: string } = {}): Promise<Item[]> => {
    const path = opts.path ?? "/";
    if (path && path !== "/") {
      const recs = await load();
      const rec = await resolve(path, Promise.resolve(recs));
      if (rec.meta.type !== "CollectionType") return [view(rec, paths(recs))];
      return list({ folder: rec.id });
    }
    return list({ folder: "" });
  };

  const search = async (opts: { query: string; tag?: string }): Promise<Item[]> => {
    const q = opts.query.toLowerCase();
    return (await list({})).filter((i) => {
      const nameHit = i.name.toLowerCase().includes(q) || i.path.toLowerCase().includes(q);
      const tagHit = opts.tag ? i.tags.includes(opts.tag) : true;
      return nameHit && tagHit;
    });
  };

  const info = async (opts: { notebook: string }): Promise<Item> => {
    const recs = await load();
    const rec = await resolve(opts.notebook, Promise.resolve(recs));
    const item = view(rec, paths(recs));
    if (item.type === "notebook") item.pages = await pageSummaries(rec);
    return item;
  };

  const readPage = async (rec: Rec, page: number): Promise<PageText> => {
    const ids = loadPageIds(rec);
    const pid = ids[page - 1];
    if (!pid) throw new Error(`page ${page} out of range (1-${ids.length})`);
    const raw = (await fs.exists(pageFile(rec.id, pid))) ? await fs.readFile(pageFile(rec.id, pid)) : blankPage();
    const native = parseNativeText(raw);
    return { fileType: "notebook", page, text: native?.text ?? "", paragraphs: native?.paragraphs ?? [] };
  };

  const pageSummaries = async (rec: Rec): Promise<{ page: number; title: string }[]> => {
    const ids = loadPageIds(rec);
    const out: { page: number; title: string }[] = [];
    for (let i = 0; i < ids.length; i++) {
      const pid = ids[i];
      let title = "";
      if (pid && (await fs.exists(pageFile(rec.id, pid)))) {
        const native = parseNativeText(await fs.readFile(pageFile(rec.id, pid)));
        const paras = native?.paragraphs ?? [];
        const headed = paras.find((p) => p.style === "title" || p.style === "heading");
        title = (headed ?? paras[0])?.text ?? "";
      }
      out.push({ page: i + 1, title });
    }
    return out;
  };

  const read = async (opts: { notebook: string; page?: number }): Promise<PageText> => {
    const rec = await resolve(opts.notebook);
    const ft = rec.content?.fileType ?? "";
    if (ft === "pdf" && (await fs.exists(`${rec.id}.pdf`))) {
      return { text: await extractPdfText(await fs.readFile(`${rec.id}.pdf`)), fileType: "pdf" };
    }
    if (ft === "epub" && (await fs.exists(`${rec.id}.epub`))) {
      return { text: await extractEpubText(await fs.readFile(`${rec.id}.epub`)), fileType: "epub" };
    }
    if (opts.page !== undefined) return readPage(rec, opts.page);
    const ids = loadPageIds(rec);
    if (!ids.length) return { fileType: "notebook", text: "", pages: [] };
    const pages: PageText[] = [];
    for (let i = 1; i <= ids.length; i++) pages.push(await readPage(rec, i));
    return { fileType: "notebook", text: pages.map((p) => p.text).filter(Boolean).join("\n\n"), pages };
  };

  const download = async (opts: { notebook: string }): Promise<{ name: string; mime: string; base64: string }> => {
    const rec = await resolve(opts.notebook);
    const ft = rec.content?.fileType;
    if (ft !== "pdf" && ft !== "epub") throw new Error("download only supports pdf/epub");
    const data = await fs.readFile(`${rec.id}.${ft}`);
    const mime = ft === "pdf" ? "application/pdf" : "application/epub+zip";
    return { name: `${rec.meta.visibleName}.${ft}`, mime, base64: Buffer.from(data).toString("base64") };
  };

  const pageFile = (id: string, pageId: string): string => `${id}/${pageId}.rm`;

  const loadPageIds = (rec: Rec): string[] => pageIds(rec.content ?? notebookContent([]));

  const exportPage = async (opts: {
    notebook: string;
    page?: number;
    format?: "png" | "svg";
  }): Promise<{ mime: string; base64: string; page: number }> => {
    const rec = await resolve(opts.notebook);
    const ids = loadPageIds(rec);
    const page = opts.page ?? 1;
    const pid = ids[page - 1];
    if (!pid) throw new Error(`page ${page} out of range (1-${ids.length})`);
    const raw = (await fs.exists(pageFile(rec.id, pid))) ? await fs.readFile(pageFile(rec.id, pid)) : blankPage();
    const { lines } = parseRm(raw);
    const format = opts.format ?? "png";
    const bytes = format === "svg" ? new TextEncoder().encode(linesToSvg(lines)) : linesToPng(lines);
    const mime = format === "svg" ? "image/svg+xml" : "image/png";
    return { mime, page, base64: Buffer.from(bytes).toString("base64") };
  };

  const upload = async (opts: {
    name: string;
    dataBase64: string;
    parent?: string;
    fileType?: "pdf" | "epub";
  }): Promise<Item> => {
    const recs = await load();
    const parent = await resolveFolder(opts.parent, recs);
    const data = Buffer.from(opts.dataBase64, "base64");
    const fileType = opts.fileType ?? sniff(opts.name, data);
    const id = crypto.randomUUID();
    const meta = defaultMetadata(opts.name.replace(/\.(pdf|epub)$/i, ""), "DocumentType", parent);
    const content = fileContent(fileType);
    await saveMeta(id, meta);
    await saveContent(id, content);
    await fs.writeFile(`${id}.${fileType}`, new Uint8Array(data));
    return afterWrite({ id, meta, content });
  };

  const mkdir = async (opts: { name: string; parent?: string }): Promise<Item> => {
    const recs = await load();
    const parent = await resolveFolder(opts.parent, recs);
    const id = crypto.randomUUID();
    const meta = defaultMetadata(opts.name, "CollectionType", parent);
    const content = folderContent();
    await saveMeta(id, meta);
    await saveContent(id, content);
    return afterWrite({ id, meta, content });
  };

  const move = async (opts: { notebook: string; folder: string }): Promise<Item> => {
    const recs = await load();
    const rec = await resolve(opts.notebook, Promise.resolve(recs));
    rec.meta.parent = await resolveFolder(opts.folder, recs);
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    return afterWrite(rec);
  };

  const rename = async (opts: { notebook: string; name: string }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    rec.meta.visibleName = opts.name;
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    return afterWrite(rec);
  };

  const remove = async (opts: { notebook: string }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    rec.meta.parent = "trash";
    rec.meta.deleted = false;
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    return afterWrite(rec);
  };

  const createNotebook = async (opts: { name: string; parent?: string }): Promise<Item> => {
    const recs = await load();
    const parent = await resolveFolder(opts.parent, recs);
    const id = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const meta = defaultMetadata(opts.name, "DocumentType", parent);
    const content = notebookContent([pageId]);
    await saveMeta(id, meta);
    await saveContent(id, content);
    await fs.mkdirp(id);
    await fs.writeFile(pageFile(id, pageId), blankPage());
    return afterWrite({ id, meta, content });
  };

  const addPage = async (opts: { notebook: string; after?: number }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    const content = rec.content ?? notebookContent([]);
    const ids = [...loadPageIds(rec)];
    const pageId = crypto.randomUUID();
    const at = opts.after === undefined ? ids.length : Math.max(0, Math.min(ids.length, opts.after));
    ids.splice(at, 0, pageId);
    rec.content = setPageIds(content, ids);
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    await saveContent(rec.id, rec.content);
    await fs.mkdirp(rec.id);
    await fs.writeFile(pageFile(rec.id, pageId), blankPage());
    return { ...(await afterWrite(rec)), page: at + 1 };
  };

  const removePage = async (opts: { notebook: string; page: number }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    const content = rec.content ?? notebookContent([]);
    const ids = [...loadPageIds(rec)];
    const pid = ids[opts.page - 1];
    if (!pid) throw new Error(`page ${opts.page} out of range`);
    ids.splice(opts.page - 1, 1);
    rec.content = setPageIds(content, ids);
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    await saveContent(rec.id, rec.content);
    if (await fs.exists(pageFile(rec.id, pid))) await fs.remove(pageFile(rec.id, pid));
    return afterWrite(rec);
  };

  const writeInk = async (opts: { notebook: string; strokes: StrokeIn[]; page?: number }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    const ids = loadPageIds(rec);
    const page = opts.page ?? (ids.length || 1);
    const pid = ids[page - 1];
    if (!pid) throw new Error(`page ${page} out of range`);
    const path = pageFile(rec.id, pid);
    const prev = (await fs.exists(path)) ? await fs.readFile(path) : null;
    await fs.mkdirp(rec.id);
    await fs.writeFile(path, appendStrokes(prev, opts.strokes));
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    return { ...(await afterWrite(rec)), page };
  };

  const writeMermaid = async (opts: { notebook: string; mermaid: string; page?: number }): Promise<Item> => {
    return writeInk({ notebook: opts.notebook, page: opts.page, strokes: mermaidToStrokes(opts.mermaid) });
  };

  const writeText = async (opts: {
    notebook: string;
    text?: string;
    style?: TextStyle;
    checked?: boolean;
    blocks?: NativePara[];
    page?: number;
    newPage?: boolean;
    replace?: boolean;
  }): Promise<Item> => {
    if (!opts.blocks?.length && opts.text === undefined) throw new Error("text or blocks is required");
    let rec = await resolve(opts.notebook);
    if (opts.newPage) rec = await resolve((await addPage({ notebook: rec.id })).id);
    const ids = loadPageIds(rec);
    const page = opts.newPage ? ids.length : (opts.page ?? (ids.length || 1));
    const pid = ids[page - 1];
    if (!pid) throw new Error(`page ${page} out of range`);
    const path = pageFile(rec.id, pid);
    const prev = (await fs.exists(path)) ? await fs.readFile(path) : blankPage();
    const paras = opts.blocks?.length
      ? opts.blocks.map((b) => {
          const style = b.style ?? "body";
          const p: NativePara = { text: b.text, style };
          if (style === "checkbox") p.checked = b.checked === true;
          return p;
        })
      : linesToParas(opts.text ?? "", opts.style ?? "body", opts.checked);
    await fs.writeFile(path, pageWithNativeText(prev, paras, opts.replace === true));
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    return { ...(await afterWrite(rec)), page };
  };

  const tag = async (opts: { notebook: string; tag: string; remove?: boolean; page?: number }): Promise<Item> => {
    const rec = await resolve(opts.notebook);
    const content = rec.content ?? (rec.meta.type === "CollectionType" ? folderContent() : notebookContent([]));
    rec.content = content;
    const ts = `1:${Date.now()}`;
    if (opts.page !== undefined) {
      const ids = loadPageIds(rec);
      const pid = ids[opts.page - 1];
      if (!pid) throw new Error(`page ${opts.page} out of range`);
      const page = content.cPages?.pages.find((p) => p.id === pid);
      if (page) {
        page.tags = page.tags ?? [];
        if (opts.remove) page.tags = page.tags.filter((t) => t.name !== opts.tag);
        else if (!page.tags.some((t) => t.name === opts.tag)) page.tags.push({ name: opts.tag, timestamp: ts });
      }
      content.pageTags = content.pageTags ?? [];
      if (opts.remove) content.pageTags = content.pageTags.filter((t) => !(t.name === opts.tag && t.pageId === pid));
      else if (!content.pageTags.some((t) => t.name === opts.tag && t.pageId === pid)) {
        content.pageTags.push({ name: opts.tag, pageId: pid, timestamp: ts });
      }
    } else {
      const apply = (list: Tag[] | undefined): Tag[] => {
        const tags = [...(list ?? [])];
        if (opts.remove) return tags.filter((t) => t.name !== opts.tag);
        if (!tags.some((t) => t.name === opts.tag)) tags.push({ name: opts.tag, timestamp: ts });
        return tags;
      };
      rec.meta.tags = apply(rec.meta.tags);
      content.tags = apply(content.tags);
    }
    touch(rec.meta);
    await saveMeta(rec.id, rec.meta);
    await saveContent(rec.id, content);
    return afterWrite(rec);
  };

  const tags = async (): Promise<string[]> => {
    const set = new Set<string>();
    for (const i of await list({ includeTrash: true })) for (const t of i.tags) set.add(t);
    return [...set].sort();
  };

  const refresh = async (): Promise<{ restarted: boolean }> => {
    await restart();
    return { restarted: true };
  };

  return {
    list,
    browse,
    search,
    info,
    read,
    download,
    exportPage,
    upload,
    mkdir,
    move,
    rename,
    remove,
    createNotebook,
    addPage,
    removePage,
    writeInk,
    writeMermaid,
    writeText,
    tag,
    tags,
    refresh,
  };
}

function sniff(name: string, data: Uint8Array): "pdf" | "epub" {
  if (name.toLowerCase().endsWith(".epub")) return "epub";
  if (name.toLowerCase().endsWith(".pdf")) return "pdf";
  const head = new TextDecoder("latin1").decode(data.subarray(0, 8));
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK")) return "epub";
  throw new Error("upload requires a pdf or epub");
}
