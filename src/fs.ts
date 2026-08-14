import { readFile, readdir, mkdir, rm, writeFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Client, type SFTPWrapper } from "ssh2";

export type Dirent = { name: string; dir: boolean };

export type TabletFs = {
  readFile(rel: string): Promise<Uint8Array>;
  writeFile(rel: string, data: Uint8Array): Promise<void>;
  remove(rel: string): Promise<void>;
  readdir(rel?: string): Promise<Dirent[]>;
  mkdirp(rel: string): Promise<void>;
  exists(rel: string): Promise<boolean>;
  /** Push writes. SSH restarts xochitl; cloud commits the hash tree; memory/local no-op. */
  apply(): Promise<boolean>;
};

export function norm(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
}

export class MemoryFs implements TabletFs {
  readonly files = new Map<string, Uint8Array>();

  async readFile(rel: string): Promise<Uint8Array> {
    const data = this.files.get(norm(rel));
    if (!data) throw new Error(`not found: ${rel}`);
    return data;
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    this.files.set(norm(rel), data);
  }

  async remove(rel: string): Promise<void> {
    const p = norm(rel);
    this.files.delete(p);
    for (const k of Array.from(this.files.keys())) {
      if (k.startsWith(`${p}/`)) this.files.delete(k);
    }
  }

  async readdir(rel = ""): Promise<Dirent[]> {
    const prefix = norm(rel);
    const names = new Map<string, boolean>();
    for (const k of this.files.keys()) {
      if (prefix && k !== prefix && !k.startsWith(`${prefix}/`)) continue;
      const rest = prefix ? k.slice(prefix.length + (k === prefix ? 0 : 1)) : k;
      if (!rest || k === prefix) continue;
      const slash = rest.indexOf("/");
      const head = slash === -1 ? rest : rest.slice(0, slash);
      names.set(head, slash !== -1 || names.get(head) === true);
    }
    return [...names].map(([name, dir]) => ({ name, dir }));
  }

  async mkdirp(_rel: string): Promise<void> {}

  async exists(rel: string): Promise<boolean> {
    const p = norm(rel);
    if (this.files.has(p)) return true;
    for (const k of this.files.keys()) if (k.startsWith(`${p}/`)) return true;
    return false;
  }

  async apply(): Promise<boolean> {
    return false;
  }
}

export async function memoryFromDir(root: string): Promise<MemoryFs> {
  const fs = new MemoryFs();
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(join(dir, e.name), r);
      else await fs.writeFile(r, await readFile(join(dir, e.name)));
    }
  };
  await walk(root, "");
  return fs;
}

export class LocalFs implements TabletFs {
  readonly root: string;
  constructor(root: string) {
    this.root = root;
  }

  private p(rel: string): string {
    return join(this.root, ...norm(rel).split("/").filter(Boolean));
  }

  async readFile(rel: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.p(rel)));
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    const path = this.p(rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async remove(rel: string): Promise<void> {
    await rm(this.p(rel), { recursive: true, force: true });
  }

  async readdir(rel = ""): Promise<Dirent[]> {
    try {
      const entries = await readdir(rel ? this.p(rel) : this.root, { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async mkdirp(rel: string): Promise<void> {
    await mkdir(this.p(rel), { recursive: true });
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.p(rel));
      return true;
    } catch {
      return false;
    }
  }

  async apply(): Promise<boolean> {
    return false;
  }
}

export const XOCHITL = "/home/root/.local/share/remarkable/xochitl";

export type SshConfig = {
  host: string;
  user: string;
  port: number;
  password?: string;
  key?: string;
};

export class SshFs implements TabletFs {
  readonly root: string;
  private readonly client: Client;
  private readonly sftp: SFTPWrapper;
  constructor(client: Client, sftp: SFTPWrapper, root = XOCHITL) {
    this.client = client;
    this.sftp = sftp;
    this.root = root;
  }

  private p(rel: string): string {
    const n = norm(rel);
    return n ? `${this.root}/${n}` : this.root;
  }

  async readFile(rel: string): Promise<Uint8Array> {
    const path = this.p(rel);
    return new Promise((resolve, reject) => {
      this.sftp.readFile(path, (err, data) => {
        if (err) reject(new Error(`not found: ${rel}`));
        else resolve(new Uint8Array(data));
      });
    });
  }

  async writeFile(rel: string, data: Uint8Array): Promise<void> {
    const path = this.p(rel);
    await this.mkdirp(dirname(rel).replace(/^\.$/, ""));
    await new Promise<void>((resolve, reject) => {
      this.sftp.writeFile(path, Buffer.from(data), (err) => (err ? reject(err) : resolve()));
    });
  }

  async remove(rel: string): Promise<void> {
    const path = this.p(rel);
    await this.sh(`rm -rf ${shellQuote(path)}`);
  }

  async readdir(rel = ""): Promise<Dirent[]> {
    const path = this.p(rel);
    return new Promise((resolve) => {
      this.sftp.readdir(path, (err, list) => {
        if (err) resolve([]);
        else resolve(list.map((e) => ({ name: e.filename, dir: (e.attrs.mode & 0o40000) !== 0 })));
      });
    });
  }

  async mkdirp(rel: string): Promise<void> {
    if (!rel || rel === ".") return;
    await this.sh(`mkdir -p ${shellQuote(this.p(rel))}`);
  }

  async exists(rel: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.sftp.stat(this.p(rel), (err) => resolve(!err));
    });
  }

  async apply(): Promise<boolean> {
    await this.sh("systemctl restart xochitl");
    return true;
  }

  private sh(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.client.exec(cmd, (err, stream) => {
        if (err) return reject(err);
        const chunks: Buffer[] = [];
        const errs: Buffer[] = [];
        stream.on("data", (d: Buffer) => chunks.push(d));
        stream.stderr.on("data", (d: Buffer) => errs.push(d));
        stream.on("close", (code: number) => {
          if (code) reject(new Error(Buffer.concat(errs).toString() || `exit ${code}`));
          else resolve(Buffer.concat(chunks).toString());
        });
      });
    });
  }

  close(): void {
    this.client.end();
  }
}

const SSH_TIMEOUT_MS = 8000;

export async function openSshFs(cfg: SshConfig): Promise<SshFs> {
  const client = new Client();
  const privateKey = await loadKey(cfg.key);
  const where = `${cfg.user}@${cfg.host}:${cfg.port}`;
  const fail = (msg: string) => new Error(`tablet SSH ${where} failed: ${msg}`);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      client.end();
      reject(fail(`timed out after ${SSH_TIMEOUT_MS}ms`));
    }, SSH_TIMEOUT_MS);
    client
      .on("ready", () => {
        clearTimeout(t);
        resolve();
      })
      .on("error", (err: Error) => {
        clearTimeout(t);
        reject(fail(err.message));
      })
      .connect({
        host: cfg.host,
        port: cfg.port,
        username: cfg.user,
        password: cfg.password,
        privateKey,
        readyTimeout: SSH_TIMEOUT_MS,
        hostVerifier: () => true,
      });
  });
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });
  return new SshFs(client, sftp);
}

async function loadKey(key?: string): Promise<Buffer | undefined> {
  if (key) {
    if (key.includes("BEGIN")) return Buffer.from(key);
    return readFile(key);
  }
  for (const name of ["id_ed25519", "id_rsa"]) {
    try {
      return await readFile(join(homedir(), ".ssh", name));
    } catch {
      /* try next */
    }
  }
  return undefined;
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export type OpenConfig = SshConfig & {
  fake?: boolean;
  fakeDir?: string;
  cloudUrl?: string;
  cloudToken?: string;
  pair?: string;
};

export async function openTablet(cfg: OpenConfig): Promise<TabletFs> {
  if (cfg.fakeDir) return new LocalFs(cfg.fakeDir);
  if (cfg.fake) return new MemoryFs();
  if (cfg.cloudUrl) {
    const { openCloudFs } = await import("./cloud.js");
    return openCloudFs(cfg);
  }
  return openSshFs(cfg);
}

/** Connect on first FS call. Failed opens are not cached, so a later call can succeed. */
export function lazyTablet(cfg: OpenConfig): TabletFs {
  let pending: Promise<TabletFs> | undefined;
  const get = () => {
    pending ??= openTablet(cfg).catch((err: unknown) => {
      pending = undefined;
      throw err;
    });
    return pending;
  };
  return {
    readFile: (rel) => get().then((fs) => fs.readFile(rel)),
    writeFile: (rel, data) => get().then((fs) => fs.writeFile(rel, data)),
    remove: (rel) => get().then((fs) => fs.remove(rel)),
    readdir: (rel) => get().then((fs) => fs.readdir(rel)),
    mkdirp: (rel) => get().then((fs) => fs.mkdirp(rel)),
    exists: (rel) => get().then((fs) => fs.exists(rel)),
    apply: () => get().then((fs) => fs.apply()),
  };
}
