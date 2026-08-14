import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApi } from "../../src/api.js";
import { CloudFs, pairDevice } from "../../src/cloud.js";
import { assertMcpTestLibrary } from "../fixtures/mcp-test/check.js";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../..", import.meta.url));
const composeFile = fileURLToPath(new URL("../../docker-compose-test.yml", import.meta.url));
const project = "remarkable-mcp-e2e";
const email = "e2e";
const password = "e2epass";

async function dockerOk(): Promise<boolean> {
  try {
    await exec("docker", ["info"], { timeout: 8_000 });
    return true;
  } catch {
    return false;
  }
}

async function compose(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec("docker", ["compose", "-f", composeFile, "-p", project, ...args], {
    cwd: root,
    timeout: 180_000,
    env: process.env,
  });
}

async function waitHealth(url: string, ms = 90_000): Promise<void> {
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(new URL("/health", url));
      last = await res.text();
      if (res.ok && last.toLowerCase().includes("working")) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`rmfakecloud never became healthy: ${last}`);
}

async function login(url: string): Promise<string> {
  const res = await fetch(new URL("/ui/api/login", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}: ${await res.text()}`);
  return (await res.text()).trim();
}

async function newCode(url: string, webToken: string): Promise<string> {
  const res = await fetch(new URL("/ui/api/newcode", url), {
    headers: { authorization: `Bearer ${webToken}` },
  });
  if (!res.ok) throw new Error(`newcode ${res.status}: ${await res.text()}`);
  const body: unknown = await res.json();
  if (typeof body === "string" && body) return body;
  throw new Error(`unexpected newcode body: ${JSON.stringify(body)}`);
}

describe("e2e rmfakecloud", () => {
  it("pairs, writes, and a second CloudFs reads it back", async () => {
    if (!(await dockerOk())) {
      throw new Error("docker is required for pnpm test:e2e");
    }
    const external = process.env.RMFAKECLOUD_E2E_URL;
    const url = external ?? "http://127.0.0.1:13000";
    let started = false;
    try {
      if (!external) {
        const dataDir = process.env.RMFAKECLOUD_E2E_DATA ?? "/tmp/remarkable-mcp-e2e-data";
        process.env.RMFAKECLOUD_E2E_DATA = dataDir;
        process.env.RMFAKECLOUD_E2E_USER = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
        await rm(dataDir, { recursive: true, force: true });
        const dest = join(dataDir, "users", email, "sync");
        await mkdir(dest, { recursive: true });
        await cp(join(root, "test/fixtures/mcp-test/sync"), dest, { recursive: true });
        await compose("down", "-v", "--remove-orphans").catch(() => undefined);
        await compose("up", "-d", "--pull", "missing");
        started = true;
        await waitHealth(url);
        // First login creates the admin (CreateFirstUser). Then flip sync15.
        await login(url);
        await compose(
          "exec",
          "-T",
          "rmfakecloud",
          "/rmfakecloud-docker",
          "setuser",
          "-u",
          email,
          "-p",
          password,
          "-a",
          "-s",
        );
      }
      const web = await login(url);
      const code = await newCode(url, web);
      const token = await pairDevice(url, code);
      const reader = createApi(new CloudFs({ url, token }));
      await assertMcpTestLibrary(reader);

      const writer = createApi(new CloudFs({ url, token }));
      await writer.createNotebook({ name: "E2E Note" });
      await writer.writeText({ notebook: "E2E Note", text: "hello from real rmfakecloud" });
      expect((await writer.flush()).applied).toBe(true);

      const again = createApi(new CloudFs({ url, token }));
      expect((await again.list({})).map((i) => i.name)).toContain("E2E Note");
      expect((await again.read({ notebook: "E2E Note", page: 1 })).text).toContain(
        "hello from real rmfakecloud",
      );
    } finally {
      if (started) {
        await compose("down", "-v", "--remove-orphans").catch(() => undefined);
        await rm(process.env.RMFAKECLOUD_E2E_DATA ?? "/tmp/remarkable-mcp-e2e-data", {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }
  }, 180_000);
});
