import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { Remarkable } from "../../../src/api.js";

export const mcpTestSync = fileURLToPath(new URL("./sync", import.meta.url));

export async function loadMcpTestSeed(): Promise<{
  blobs: Map<string, Uint8Array>;
  rootHash: string;
}> {
  const rootHash = (await readFile(join(mcpTestSync, "root"), "utf8")).trim();
  const blobs = new Map<string, Uint8Array>();
  for (const name of await readdir(mcpTestSync)) {
    if (name === "root") continue;
    blobs.set(name, await readFile(join(mcpTestSync, name)));
  }
  return { blobs, rootHash };
}

/** Asserts the tablet-verified /mcp-test dump through any Remarkable API. */
export async function assertMcpTestLibrary(rm: Remarkable): Promise<void> {
  const listed = await rm.list({});
  const paths = listed.map((i) => i.path);
  expect(paths.filter((p) => p === "/mcp-test" || p.startsWith("/mcp-test/")).sort()).toEqual([
    "/mcp-test",
    "/mcp-test/Diagram",
    "/mcp-test/Nested",
    "/mcp-test/Nested/Inside",
    "/mcp-test/Welcome",
  ]);

  const byPath = new Map(listed.map((i) => [i.path, i]));
  expect(byPath.get("/mcp-test")?.type).toBe("folder");
  expect(byPath.get("/mcp-test/Nested")?.type).toBe("folder");
  expect(byPath.get("/mcp-test/Welcome")?.type).toBe("notebook");
  expect(byPath.get("/mcp-test/Welcome")?.pageCount).toBe(2);
  expect(byPath.get("/mcp-test/Welcome")?.tags).toEqual(expect.arrayContaining(["mcp", "test"]));
  expect(byPath.get("/mcp-test/Diagram")?.pageCount).toBe(1);
  expect(byPath.get("/mcp-test/Nested/Inside")?.pageCount).toBe(1);

  expect((await rm.browse({ path: "/mcp-test" })).map((i) => i.name).sort()).toEqual([
    "Diagram",
    "Nested",
    "Welcome",
  ]);
  expect((await rm.browse({ path: "/mcp-test/Nested" })).map((i) => i.name)).toEqual(["Inside"]);

  expect((await rm.search({ query: "welcome", tag: "mcp" })).map((i) => i.path)).toEqual([
    "/mcp-test/Welcome",
  ]);
  expect((await rm.search({ query: "Inside" })).map((i) => i.path)).toEqual([
    "/mcp-test/Nested/Inside",
  ]);
  expect(await rm.tags()).toEqual(expect.arrayContaining(["mcp", "test"]));

  const info = await rm.info({ notebook: "/mcp-test/Welcome" });
  expect(info.pages).toEqual([
    { page: 1, title: "mcp-test" },
    { page: 2, title: "Tags mcp + test on this notebook" },
  ]);

  const welcome = await rm.read({ notebook: "/mcp-test/Welcome" });
  expect(welcome.pages).toHaveLength(2);
  expect(welcome.text).toContain("remarkable_execute");
  expect(welcome.text).toContain("This is page 2 of Welcome");

  const p1 = await rm.read({ notebook: "/mcp-test/Welcome", page: 1 });
  expect(p1.paragraphs?.map((p) => p.style)).toEqual(["title", "body"]);
  expect(p1.text).toContain("Written by remarkable_execute over rmfakecloud.");

  const p2 = await rm.read({ notebook: "/mcp-test/Welcome", page: 2 });
  expect(p2.paragraphs?.filter((p) => p.style === "checkbox").map((p) => p.text)).toEqual([
    "Checklist",
    "Folder mcp-test exists",
    "This is page 2 of Welcome",
  ]);

  const inside = await rm.read({ notebook: "/mcp-test/Nested/Inside" });
  expect(inside.text).toContain("Nested notebook");
  expect(inside.text).toContain("/mcp-test/Nested/Inside");

  const png = await rm.exportPage({ notebook: "/mcp-test/Diagram", format: "png" });
  expect(png.mime).toBe("image/png");
  const pngBytes = Buffer.from(png.base64, "base64");
  expect(pngBytes.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  expect(pngBytes.byteLength).toBeGreaterThan(2000);

  const svg = await rm.exportPage({ notebook: "/mcp-test/Diagram", format: "svg" });
  expect(svg.mime).toBe("image/svg+xml");
  expect(Buffer.from(svg.base64, "base64").toString()).toMatch(/<path/i);
}
