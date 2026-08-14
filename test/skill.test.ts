import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillPath = fileURLToPath(new URL("../skills/remarkable-mcp/SKILL.md", import.meta.url));

describe("skills.sh skill", () => {
  it("teaches Code Mode usage of rme.*, not install", async () => {
    const body = await readFile(skillPath, "utf8");
    expect(basename(dirname(skillPath))).toBe("remarkable-mcp");
    const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).toBeTruthy();
    expect(fm?.[1]).toMatch(/^name:\s*remarkable-mcp\s*$/m);
    expect(fm?.[1]).toMatch(/^description:\s*.+/m);

    expect(body).toMatch(/remarkable_execute/);
    expect(body).toMatch(/rme\./);
    for (const method of [
      "list",
      "browse",
      "search",
      "info",
      "read",
      "download",
      "exportPage",
      "upload",
      "mkdir",
      "move",
      "rename",
      "remove",
      "createNotebook",
      "addPage",
      "removePage",
      "writeInk",
      "writeMermaid",
      "writeText",
      "tag",
      "tags",
      "refresh",
    ]) {
      expect(body).toContain(`rme.${method}`);
    }

    expect(body).toMatch(/1-based/);
    expect(body).toMatch(/Appends/);
    expect(body).toMatch(/trash/i);
    expect(body).toMatch(/rmfakecloud/i);
    expect(body).not.toMatch(/mcpServers/);
    expect(body).not.toMatch(/REMARKABLE_PASSWORD/);
    expect(body).not.toMatch(/npx/);
    expect(body).not.toMatch(/REMARKABLE_TOKEN/);
    expect(body.toLowerCase()).not.toMatch(/connect subscription/);
  });
});
