import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import {
  CloudFs,
  hashEntries,
  pairDevice,
  parseIndex,
  serializeIndex,
  sha256,
  type IndexEntry,
} from "../src/cloud.js";
import { blankPage } from "../src/rm.js";
import { defaultMetadata, encodeJson, notebookContent } from "../src/xochitl.js";
import { assertMcpTestLibrary, loadMcpTestSeed } from "./fixtures/mcp-test/check.js";

type Put = { path: string; body: Uint8Array };

function seedNotebook(name: string): {
  id: string;
  name: string;
  blobs: Map<string, Uint8Array>;
  rootHash: string;
} {
  const id = crypto.randomUUID();
  const pageId = crypto.randomUUID();
  const meta = encodeJson(defaultMetadata(name, "DocumentType", ""));
  const content = encodeJson(notebookContent([pageId]));
  const page = blankPage();
  const files: IndexEntry[] = [
    { hash: sha256(meta), type: "0", name: `${id}.metadata`, subfiles: 0, size: meta.byteLength },
    {
      hash: sha256(content),
      type: "0",
      name: `${id}.content`,
      subfiles: 0,
      size: content.byteLength,
    },
    { hash: sha256(page), type: "0", name: `${pageId}.rm`, subfiles: 0, size: page.byteLength },
  ];
  const index = new TextEncoder().encode(serializeIndex(files, "file"));
  const docHash = hashEntries(files);
  let size = 0;
  for (const f of files) size += f.size;
  const rootEnt: IndexEntry = {
    hash: docHash,
    type: "80000000",
    name: id,
    subfiles: files.length,
    size,
  };
  const rootIndex = new TextEncoder().encode(serializeIndex([rootEnt], "doc"));
  const rootHash = hashEntries([rootEnt]);
  const blobs = new Map<string, Uint8Array>([
    [sha256(meta), meta],
    [sha256(content), content],
    [sha256(page), page],
    [docHash, index],
    [rootHash, rootIndex],
  ]);
  return { id, name, blobs, rootHash };
}

async function mockSync(opts?: {
  clashFirst?: boolean;
  alwaysClash?: boolean;
  failRoot?: number;
  seed?: { blobs: Map<string, Uint8Array>; rootHash: string };
  clashSeed?: { blobs: Map<string, Uint8Array>; rootHash: string };
}): Promise<{
  url: string;
  close: () => Promise<void>;
  puts: Put[];
  roots: { hash: string; generation: number }[];
}> {
  const blobs = new Map<string, Uint8Array>(opts?.seed?.blobs ?? []);
  const puts: Put[] = [];
  const roots: { hash: string; generation: number }[] = [];
  let generation = opts?.seed ? 1 : 0;
  let rootHash = opts?.seed?.rootHash ?? "";
  let clash = opts?.clashFirst === true || opts?.clashSeed !== undefined;
  let failRoot = opts?.failRoot ?? 0;

  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);

    if (req.method === "POST" && url.pathname === "/token/json/2/device/new") {
      res.end("device-jwt");
      return;
    }
    if (req.method === "POST" && url.pathname === "/token/json/2/user/new") {
      res.end("user-jwt");
      return;
    }
    if (req.method === "GET" && url.pathname === "/sync/v3/root") {
      if (failRoot > 0) {
        failRoot -= 1;
        res.statusCode = 500;
        res.end("root unavailable");
        return;
      }
      if (!rootHash) {
        res.statusCode = 404;
        res.end(JSON.stringify({ message: "root not found" }));
        return;
      }
      res.end(JSON.stringify({ generation, hash: rootHash }));
      return;
    }
    if (req.method === "PUT" && url.pathname === "/sync/v3/root") {
      const j = JSON.parse(body.toString()) as { hash: string; generation: number };
      if (opts?.alwaysClash || clash) {
        clash = false;
        generation += 1;
        if (opts.clashSeed) {
          for (const [hash, data] of opts.clashSeed.blobs) blobs.set(hash, data);
          rootHash = opts.clashSeed.rootHash;
        }
        res.statusCode = 409;
        res.end("generation clash");
        return;
      }
      generation = j.generation + 1;
      rootHash = j.hash;
      roots.push({ hash: j.hash, generation });
      res.end(JSON.stringify({ generation, hash: j.hash }));
      return;
    }
    const file = url.pathname.match(/^\/sync\/v3\/files\/([0-9a-f]+)$/);
    if (file?.[1] && req.method === "PUT") {
      const data = new Uint8Array(body);
      blobs.set(file[1], data);
      puts.push({ path: url.pathname, body: data });
      res.end();
      return;
    }
    if (file?.[1] && req.method === "GET") {
      const data = blobs.get(file[1]);
      if (!data) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.end(Buffer.from(data));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no listen address");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    puts,
    roots,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe("rmfakecloud sync v3", () => {
  it("createApi write + flush PUTs blobs and a new root", async () => {
    const mock = await mockSync();
    try {
      const fs = new CloudFs({ url: mock.url, token: "dev" });
      const rm = createApi(fs);
      await rm.createNotebook({ name: "CloudNote" });
      await rm.writeText({ notebook: "CloudNote", text: "hello from cloud" });
      expect((await rm.flush()).applied).toBe(true);
      expect(mock.puts.some((p) => p.path.startsWith("/sync/v3/files/"))).toBe(true);
      expect(mock.roots).toHaveLength(1);
      expect(mock.roots[0]?.hash).toMatch(/^[0-9a-f]{64}$/);
      const listed = await rm.list({});
      expect(listed.map((i) => i.name)).toEqual(["CloudNote"]);
      const page = await rm.read({ notebook: "CloudNote", page: 1 });
      expect(page.text).toContain("hello from cloud");

      const rootBlob = mock.puts.find((p) => {
        const text = new TextDecoder().decode(p.body);
        return text.startsWith("3\n") && text.includes(":80000000:");
      });
      expect(rootBlob).toBeTruthy();
      const docs = parseIndex(new TextDecoder().decode(rootBlob!.body));
      expect(docs.length).toBe(1);
      const fileIdx = mock.puts
        .map((p) => new TextDecoder().decode(p.body))
        .find((t) => t.startsWith("3\n") && t.includes(".rm") && !t.includes(":80000000:"));
      expect(fileIdx).toMatch(/[0-9a-f-]{36}\/[0-9a-f-]{36}\.rm/);
    } finally {
      await mock.close();
    }
  });

  it("retries apply once on a stale generation then succeeds", async () => {
    const mock = await mockSync({ clashFirst: true });
    try {
      const fs = new CloudFs({ url: mock.url, token: "dev" });
      const rm = createApi(fs);
      await rm.createNotebook({ name: "Retry" });
      expect((await rm.flush()).applied).toBe(true);
      expect(mock.roots).toHaveLength(1);
    } finally {
      await mock.close();
    }
  });

  it("retries once then fails loud on a second clash", async () => {
    const mock = await mockSync({ alwaysClash: true });
    try {
      const fs = new CloudFs({ url: mock.url, token: "dev" });
      const rm = createApi(fs);
      await rm.createNotebook({ name: "Nope" });
      await expect(rm.flush()).rejects.toThrow(/generation clash/);
    } finally {
      await mock.close();
    }
  });

  it("reads the tablet-verified mcp-test fixture dump", async () => {
    const seed = await loadMcpTestSeed();
    const mock = await mockSync({ seed });
    try {
      const rm = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      await assertMcpTestLibrary(rm);
    } finally {
      await mock.close();
    }
  });

  it("reloads when remote generation moves and there are no local writes", async () => {
    const seed = seedNotebook("KeepMe");
    const mock = await mockSync({ seed });
    try {
      const a = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      expect((await a.info({ notebook: "KeepMe" })).pageCount).toBe(1);

      const b = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      await b.addPage({ notebook: "KeepMe" });
      expect((await b.flush()).applied).toBe(true);

      expect((await a.info({ notebook: "KeepMe" })).pageCount).toBe(2);
    } finally {
      await mock.close();
    }
  });

  it("rebases dirty local writes onto a newer remote generation", async () => {
    const seed = seedNotebook("KeepMe");
    const mock = await mockSync({ seed });
    try {
      const a = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      expect((await a.info({ notebook: "KeepMe" })).pageCount).toBe(1);
      const extra = await a.createNotebook({ name: "Extra" });

      const b = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      await b.addPage({ notebook: "KeepMe" });
      expect((await b.flush()).applied).toBe(true);

      expect((await a.flush()).applied).toBe(true);
      expect((await a.list({})).map((i) => i.name).sort()).toEqual(["Extra", "KeepMe"]);
      expect((await a.info({ notebook: "KeepMe" })).pageCount).toBe(2);

      const rootPuts = mock.puts.filter((p) => {
        const text = new TextDecoder().decode(p.body);
        return text.startsWith("3\n") && text.includes(":80000000:");
      });
      const ids = parseIndex(new TextDecoder().decode(rootPuts.at(-1)!.body)).map((e) => e.name);
      expect(ids).toContain(seed.id);
      expect(ids).toContain(extra.id);
    } finally {
      await mock.close();
    }
  });

  it("clash retry reloads the remote tree instead of overwriting it", async () => {
    const tablet = seedNotebook("TabletNote");
    const mock = await mockSync({ clashSeed: tablet });
    try {
      const rm = createApi(new CloudFs({ url: mock.url, token: "dev" }));
      const extra = await rm.createNotebook({ name: "Extra" });
      expect((await rm.flush()).applied).toBe(true);
      expect((await rm.list({})).map((i) => i.name).sort()).toEqual(["Extra", "TabletNote"]);

      const rootPuts = mock.puts.filter((p) => {
        const text = new TextDecoder().decode(p.body);
        return text.startsWith("3\n") && text.includes(":80000000:");
      });
      const ids = parseIndex(new TextDecoder().decode(rootPuts.at(-1)!.body)).map((e) => e.name);
      expect(ids).toContain(tablet.id);
      expect(ids).toContain(extra.id);
    } finally {
      await mock.close();
    }
  });

  it("failed first GET /sync/v3/root does not wipe the remote library on later flush", async () => {
    const seed = seedNotebook("KeepMe");
    const mock = await mockSync({ failRoot: 1, seed });
    try {
      const fs = new CloudFs({ url: mock.url, token: "dev" });
      const rm = createApi(fs);
      await expect(rm.list({})).rejects.toThrow(/GET \/sync\/v3\/root 500/);
      const listed = await rm.list({});
      expect(listed.map((i) => i.name)).toEqual(["KeepMe"]);
      const created = await rm.createNotebook({ name: "Extra" });
      expect((await rm.flush()).applied).toBe(true);
      expect((await rm.list({})).map((i) => i.name).sort()).toEqual(["Extra", "KeepMe"]);
      const rootPuts = mock.puts.filter((p) => {
        const text = new TextDecoder().decode(p.body);
        return text.startsWith("3\n") && text.includes(":80000000:");
      });
      const last = rootPuts.at(-1);
      expect(last).toBeTruthy();
      const ids = parseIndex(new TextDecoder().decode(last!.body)).map((e) => e.name);
      expect(ids).toContain(seed.id);
      expect(ids).toContain(created.id);
    } finally {
      await mock.close();
    }
  });

  it("pairs with an 8-letter code", async () => {
    const mock = await mockSync();
    try {
      expect(await pairDevice(mock.url, "ABCDEFGH")).toBe("device-jwt");
    } finally {
      await mock.close();
    }
  });
});
