import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CloudFs } from "../src/cloud.js";
import { LocalFs, MemoryFs, lazyTablet, openTablet } from "../src/fs.js";
import { backendName, loadConfig } from "../src/index.js";

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));

describe("config and transport", () => {
  it("defaults to root@10.11.99.1:22 and treats --fake as memory", async () => {
    const live = loadConfig({}, []);
    expect(live.host).toBe("10.11.99.1");
    expect(live.user).toBe("root");
    expect(live.port).toBe(22);
    expect(live.fake).toBe(false);
    expect(live.http).toBe(false);
    expect(loadConfig({ MCP_HTTP: "1", PORT: "9090" }, []).http).toBe(true);
    expect(loadConfig({ MCP_HTTP: "1", PORT: "9090" }, []).httpPort).toBe(9090);
    expect(loadConfig({}, ["--http", "--http-port", "3001"]).httpPort).toBe(3001);

    const fake = loadConfig({ REMARKABLE_FAKE: "1" }, []);
    expect(fake.fake).toBe(true);
    expect(await openTablet(fake)).toBeInstanceOf(MemoryFs);
    expect(await openTablet({ ...live, fakeDir: srcRoot })).toBeInstanceOf(LocalFs);

    const cloud = loadConfig(
      { RMFAKECLOUD_URL: "http://127.0.0.1:3000", RMFAKECLOUD_TOKEN: "dev" },
      [],
    );
    expect(cloud.cloudUrl).toBe("http://127.0.0.1:3000");
    expect(backendName(cloud)).toBe("rmfakecloud");
    expect(backendName(fake)).toBe("fake");
    expect(backendName(live)).toBe("ssh");
    expect(await openTablet(cloud)).toBeInstanceOf(CloudFs);
  });

  it("lazyTablet does not open until first use and retries after a failed open", async () => {
    const fs = lazyTablet({ host: "127.0.0.1", user: "root", port: 1 });
    await expect(fs.exists("x")).rejects.toThrow(/tablet SSH.*ECONNREFUSED|connect/i);
    await expect(fs.exists("x")).rejects.toThrow(/tablet SSH.*ECONNREFUSED|connect/i);

    const blackhole = lazyTablet({ host: "192.0.2.1", user: "root", port: 22 });
    const t0 = Date.now();
    await expect(blackhole.exists("x")).rejects.toThrow(/tablet SSH.*timed out/i);
    expect(Date.now() - t0).toBeLessThan(12_000);

    const mem = lazyTablet({ host: "unused", user: "root", port: 22, fake: true });
    expect(await mem.exists("missing")).toBe(false);
    await mem.writeFile("a", new Uint8Array([1]));
    expect(await mem.exists("a")).toBe(true);
  }, 15_000);

  it("bans official-cloud and USB-web strings, allows rmfakecloud sync", async () => {
    const files = await walk(srcRoot);
    const banned = [/my\.remarkable\.com/, /REMARKABLE_TOKEN/, /http:\/\/10\.11\.99\.1/];
    let mentionsSync = false;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const re of banned) {
        expect(text, `${file} matches ${re}`).not.toMatch(re);
      }
      if (text.includes("/sync/v3/root")) mentionsSync = true;
    }
    expect(mentionsSync).toBe(true);
    const api = await readFile(join(srcRoot, "api.ts"), "utf8");
    expect(api).not.toMatch(/systemctl restart xochitl/);
    expect(api).not.toMatch(/\.exec\(/);
    const ssh = await readFile(join(srcRoot, "fs.ts"), "utf8");
    expect(ssh).toMatch(/systemctl restart xochitl/);
  });
});

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}
