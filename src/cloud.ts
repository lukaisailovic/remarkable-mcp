import { createHash } from "node:crypto";
import { MemoryFs, norm, type Dirent, type OpenConfig, type TabletFs } from "./fs.js";

const DOC = "80000000";
const FILE = "0";

export type IndexEntry = {
  hash: string;
  type: string;
  name: string;
  subfiles: number;
  size: number;
};

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Document/root id: sha256 of child hashes, sorted by name (rmfakecloud HashEntries). */
export function hashEntries(entries: IndexEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const h = createHash("sha256");
  for (const e of sorted) h.update(Buffer.from(e.hash, "hex"));
  return h.digest("hex");
}

export function parseIndex(text: string): IndexEntry[] {
  const lines = text.split("\n").map((l) => l.trimEnd());
  const schema = lines[0];
  let i = 1;
  if (schema === "4") i = 2;
  else if (schema !== "3") throw new Error(`unsupported hash index schema: ${schema ?? ""}`);
  const out: IndexEntry[] = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const [hash, type, name, sub, size] = line.split(":");
    if (!hash || !type || name === undefined || !sub || size === undefined)
      throw new Error(`bad index line: ${line}`);
    out.push({ hash, type, name, subfiles: Number(sub), size: Number(size) });
  }
  return out;
}

export function serializeIndex(entries: IndexEntry[], kind: "file" | "doc"): string {
  const lines = ["3"];
  for (const e of entries) {
    const type = kind === "doc" ? DOC : FILE;
    const sub = kind === "doc" ? String(e.subfiles) : "0";
    lines.push(`${e.hash}:${type}:${e.name}:${sub}:${e.size}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function pairDevice(
  url: string,
  code: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchFn(new URL("/token/json/2/device/new", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: code.toLowerCase(),
      deviceDesc: "desktop-linux",
      deviceID: crypto.randomUUID(),
    }),
  });
  if (!res.ok) throw new Error(`rmfakecloud pair failed: ${res.status}`);
  return res.text();
}

function xochitlPath(docId: string, cloudName: string): string {
  if (
    cloudName.endsWith(".metadata") ||
    cloudName.endsWith(".content") ||
    cloudName.endsWith(".pdf") ||
    cloudName.endsWith(".epub") ||
    cloudName.endsWith(".pagedata")
  )
    return cloudName;
  return `${docId}/${cloudName}`;
}

function splitXochitl(rel: string): { id: string; name: string } {
  const n = norm(rel);
  const slash = n.indexOf("/");
  if (slash === -1) {
    const id = n.replace(/\.(metadata|content|pdf|epub|pagedata)$/i, "");
    return { id, name: n };
  }
  return { id: n.slice(0, slash), name: n.slice(slash + 1) };
}

type CloudDoc = { id: string; files: Map<string, IndexEntry> };

export class CloudFs implements TabletFs {
  readonly url: string;
  readonly deviceToken: string;
  private readonly fetchFn: typeof fetch;
  private userJwt = "";
  private userExp = 0;
  private generation = 0;
  private loaded = false;
  private readonly mem = new MemoryFs();
  private readonly docs = new Map<string, CloudDoc>();
  private readonly remote = new Map<string, string>();
  private readonly dirty = new Set<string>();

  constructor(opts: { url: string; token: string; fetch?: typeof fetch }) {
    this.url = opts.url.replace(/\/+$/, "");
    this.deviceToken = opts.token;
    this.fetchFn = opts.fetch ?? fetch;
  }

  private async session(): Promise<string> {
    if (this.userJwt && Date.now() < this.userExp) return this.userJwt;
    const res = await this.fetchFn(new URL("/token/json/2/user/new", this.url), {
      method: "POST",
      headers: { authorization: `Bearer ${this.deviceToken}` },
    });
    if (!res.ok) throw new Error(`rmfakecloud user token failed: ${res.status}`);
    this.userJwt = (await res.text()).trim();
    this.userExp = Date.now() + 2.5 * 3600 * 1000;
    return this.userJwt;
  }

  private async api(
    path: string,
    init: RequestInit = {},
  ): Promise<{ res: Response; buf: Uint8Array }> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${await this.session()}`);
    const res = await this.fetchFn(new URL(path, this.url), { ...init, headers });
    const buf = new Uint8Array(await res.arrayBuffer());
    return { res, buf };
  }

  private async getRoot(): Promise<{ generation: number; hash: string }> {
    const { res, buf } = await this.api("/sync/v3/root");
    if (res.status === 404) return { generation: 0, hash: "" };
    if (!res.ok) throw new Error(`GET /sync/v3/root ${res.status}`);
    const j = JSON.parse(new TextDecoder().decode(buf)) as {
      generation?: number;
      hash?: string;
    };
    return { generation: Number(j.generation ?? 0), hash: j.hash ?? "" };
  }

  private async getBlob(hash: string): Promise<Uint8Array> {
    const { res, buf } = await this.api(`/sync/v3/files/${hash}`);
    if (!res.ok) throw new Error(`GET /sync/v3/files/${hash} ${res.status}`);
    return buf;
  }

  private async putBlob(hash: string, data: Uint8Array): Promise<void> {
    const { res } = await this.api(`/sync/v3/files/${hash}`, {
      method: "PUT",
      body: Buffer.from(data),
    });
    if (!res.ok) throw new Error(`PUT /sync/v3/files/${hash} ${res.status}`);
  }

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const root = await this.getRoot();
      const docs = new Map<string, CloudDoc>();
      const remote = new Map<string, string>();
      if (root.hash) {
        const index = parseIndex(new TextDecoder().decode(await this.getBlob(root.hash)));
        for (const docEnt of index) {
          const files = parseIndex(new TextDecoder().decode(await this.getBlob(docEnt.hash)));
          const doc: CloudDoc = { id: docEnt.name, files: new Map() };
          for (const f of files) {
            doc.files.set(f.name, f);
            remote.set(xochitlPath(doc.id, f.name), f.hash);
          }
          docs.set(doc.id, doc);
        }
      }
      this.generation = root.generation;
      this.docs.clear();
      for (const [id, doc] of docs) this.docs.set(id, doc);
      this.remote.clear();
      for (const [p, hash] of remote) this.remote.set(p, hash);
      this.loaded = true;
    } catch (err) {
      this.loaded = false;
      throw err;
    }
  }

  async readFile(rel: string): Promise<Uint8Array> {
    await this.ensure();
    const p = norm(rel);
    if (await this.mem.exists(p)) return this.mem.readFile(p);
    const hash = this.remote.get(p);
    if (!hash) throw new Error(`not found: ${rel}`);
    const data = await this.getBlob(hash);
    await this.mem.writeFile(p, data);
    return data;
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    await this.ensure();
    const p = norm(rel);
    await this.mem.writeFile(p, data);
    this.dirty.add(p);
  }

  async remove(rel: string): Promise<void> {
    await this.ensure();
    const p = norm(rel);
    await this.mem.remove(p);
    this.remote.delete(p);
    this.dirty.add(p);
  }

  async readdir(rel = ""): Promise<Dirent[]> {
    await this.ensure();
    const prefix = norm(rel);
    const names = new Map<string, boolean>();
    const add = (path: string) => {
      if (prefix && path !== prefix && !path.startsWith(`${prefix}/`)) return;
      const rest = prefix ? path.slice(prefix.length + (path === prefix ? 0 : 1)) : path;
      if (!rest || path === prefix) return;
      const slash = rest.indexOf("/");
      names.set(slash === -1 ? rest : rest.slice(0, slash), slash !== -1);
    };
    for (const p of this.mem.files.keys()) add(p);
    for (const p of this.remote.keys()) add(p);
    return [...names].map(([name, dir]) => ({ name, dir }));
  }

  async mkdirp(_rel: string): Promise<void> {
    await this.ensure();
  }

  async exists(rel: string): Promise<boolean> {
    await this.ensure();
    const p = norm(rel);
    if (await this.mem.exists(p)) return true;
    if (this.remote.has(p)) return true;
    for (const k of this.remote.keys()) if (k.startsWith(`${p}/`)) return true;
    return false;
  }

  async apply(): Promise<boolean> {
    await this.ensure();
    if (!this.dirty.size) return false;
    await this.commit(0);
    return true;
  }

  private async commit(attempt: number): Promise<void> {
    const byDoc = new Map<string, CloudDoc>();
    for (const [id, d] of this.docs) {
      byDoc.set(id, { id, files: new Map(d.files) });
    }
    for (const p of this.dirty) {
      const { id, name } = splitXochitl(p);
      let doc = byDoc.get(id);
      if (!doc) {
        doc = { id, files: new Map() };
        byDoc.set(id, doc);
      }
      if (await this.mem.exists(p)) {
        const data = await this.mem.readFile(p);
        const hash = sha256(data);
        await this.putBlob(hash, data);
        doc.files.set(name, { hash, type: FILE, name, subfiles: 0, size: data.byteLength });
        this.remote.set(p, hash);
      } else {
        doc.files.delete(name);
        this.remote.delete(p);
      }
    }
    const rootEntries: IndexEntry[] = [];
    for (const doc of byDoc.values()) {
      if (!doc.files.size) continue;
      const files = [...doc.files.values()];
      const index = new TextEncoder().encode(serializeIndex(files, "file"));
      const hash = hashEntries(files);
      await this.putBlob(hash, index);
      let size = 0;
      for (const f of files) size += f.size;
      rootEntries.push({ hash, type: DOC, name: doc.id, subfiles: files.length, size });
      this.docs.set(doc.id, doc);
    }
    this.docs.clear();
    for (const doc of byDoc.values()) {
      if (doc.files.size) this.docs.set(doc.id, doc);
    }
    const rootIndex = new TextEncoder().encode(serializeIndex(rootEntries, "doc"));
    const rootHash = hashEntries(rootEntries);
    await this.putBlob(rootHash, rootIndex);
    const { res, buf } = await this.api("/sync/v3/root", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hash: rootHash,
        generation: this.generation,
        broadcast: true,
      }),
    });
    if (res.ok) {
      const j = JSON.parse(new TextDecoder().decode(buf)) as { generation?: number };
      this.generation = Number(j.generation ?? this.generation);
      this.dirty.clear();
      return;
    }
    const clash = res.status === 409 || res.status === 412 || res.status === 500;
    if (!clash || attempt >= 1) {
      throw new Error(`cloud apply failed: generation clash (${res.status})`);
    }
    const fresh = await this.getRoot();
    this.generation = fresh.generation;
    await this.commit(1);
  }
}

export async function openCloudFs(cfg: OpenConfig): Promise<CloudFs> {
  if (!cfg.cloudUrl) throw new Error("rmfakecloud URL is required");
  let token = cfg.cloudToken;
  if (cfg.pair) {
    token = await pairDevice(cfg.cloudUrl, cfg.pair);
    console.error(`rmfakecloud device token:\n${token}`);
  }
  if (!token) throw new Error("rmfakecloud requires --token / RMFAKECLOUD_TOKEN or --pair");
  return new CloudFs({ url: cfg.cloudUrl, token });
}
