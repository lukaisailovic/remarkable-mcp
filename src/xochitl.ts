export type DocType = "DocumentType" | "CollectionType";

export type Tag = { name: string; timestamp: string };

export type Metadata = {
  visibleName: string;
  type: DocType;
  parent: string;
  lastModified: string;
  lastOpened?: string;
  lastOpenedPage?: number;
  metadatamodified: boolean;
  modified: boolean;
  pinned: boolean;
  synced: boolean;
  deleted: boolean;
  version: number;
  tags?: Tag[];
};

export type CPage = {
  id: string;
  idx?: { timestamp?: string; value?: string };
  template?: { timestamp?: string; value?: string };
  tags?: Tag[];
};

export type Content = {
  fileType: string;
  pageCount: number;
  pages?: string[];
  cPages?: {
    lastOpened?: { timestamp: string; value: string };
    original?: { timestamp: string; value: number };
    pages: CPage[];
  };
  tags?: Tag[];
  pageTags?: { name: string; pageId?: string; timestamp?: string }[];
  formatVersion?: number;
  orientation?: string;
  extraMetadata?: Record<string, string>;
  dummyDocument?: boolean;
  coverPageNumber?: number;
  textAlignment?: string;
  textScale?: number;
  lineHeight?: number;
  margins?: number;
  zoomMode?: string;
};

export function decodeJson<T>(buf: Uint8Array): T {
  return JSON.parse(new TextDecoder().decode(buf)) as T;
}

export function encodeJson(obj: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(obj));
}

export function nowMs(): string {
  return Date.now().toString();
}

export function crdtTs(n = 1): string {
  return `1:${n}`;
}

export function defaultMetadata(name: string, type: DocType, parent = ""): Metadata {
  return {
    visibleName: name,
    type,
    parent,
    lastModified: nowMs(),
    lastOpened: nowMs(),
    lastOpenedPage: 0,
    metadatamodified: true,
    modified: true,
    pinned: false,
    synced: false,
    deleted: false,
    version: 1,
    tags: [],
  };
}

export function notebookContent(ids: string[]): Content {
  const pages: CPage[] = ids.map((id, i) => ({
    id,
    idx: { timestamp: crdtTs(i + 2), value: idxValue(i) },
    template: { timestamp: crdtTs(1), value: "Blank" },
  }));
  return {
    cPages: {
      lastOpened: { timestamp: crdtTs(1), value: ids[0] ?? "" },
      original: { timestamp: "0:0", value: -1 },
      pages,
    },
    coverPageNumber: -1,
    extraMetadata: {},
    fileType: "notebook",
    formatVersion: 2,
    lineHeight: -1,
    orientation: "portrait",
    pageCount: ids.length,
    pageTags: [],
    tags: [],
    textAlignment: "justify",
    textScale: 1,
    zoomMode: "bestFit",
  };
}

export function fileContent(fileType: "pdf" | "epub", pageCount = 0): Content {
  return {
    extraMetadata: {},
    fileType,
    formatVersion: 1,
    orientation: "portrait",
    pageCount,
    pages: [],
    tags: [],
  };
}

export function folderContent(): Content {
  return { dummyDocument: false, extraMetadata: {}, fileType: "", pageCount: 0, pages: [], tags: [] };
}

export function pageIds(c: Content): string[] {
  if (c.cPages?.pages.length) return c.cPages.pages.map((p) => p.id);
  return c.pages ?? [];
}

export function setPageIds(c: Content, ids: string[]): Content {
  if (c.cPages) {
    c.cPages.pages = ids.map((id, i) => {
      const prev = c.cPages?.pages.find((p) => p.id === id);
      return prev ?? { id, idx: { timestamp: crdtTs(i + 2), value: idxValue(i) }, template: { timestamp: crdtTs(1), value: "Blank" } };
    });
    const first = ids[0];
    if (first) c.cPages.lastOpened = { timestamp: crdtTs(1), value: first };
  } else {
    c.pages = ids;
  }
  c.pageCount = ids.length;
  return c;
}

export function docTags(meta: Metadata, content: Content | undefined): string[] {
  const names = new Set<string>();
  for (const t of meta.tags ?? []) names.add(t.name);
  for (const t of content?.tags ?? []) names.add(t.name);
  return [...names];
}

export function isTrash(meta: Metadata): boolean {
  return meta.deleted || meta.parent === "trash";
}

/** Lexicographic page index used by firmware 3.x (`ba`, `bb`, …). */
export function idxValue(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s || "a";
}

export function touch(meta: Metadata): Metadata {
  meta.lastModified = nowMs();
  meta.modified = true;
  meta.metadatamodified = true;
  meta.version += 1;
  return meta;
}
