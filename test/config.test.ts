import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LocalFs, MemoryFs, openTablet } from "../src/fs.js";
import { loadConfig } from "../src/index.js";

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
  });

  it("shipped source has no cloud or USB-web transport", async () => {
    const files = await walk(srcRoot);
    const banned = [
      /my\.remarkable\.com/,
      /REMARKABLE_TOKEN/,
      /http:\/\/10\.11\.99\.1/,
      /rmapi/,
      /cloud.?fallback/i,
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const re of banned) {
        expect(text, `${file} matches ${re}`).not.toMatch(re);
      }
    }
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
