import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const skillPath = fileURLToPath(new URL("../skills/remarkable-mcp/SKILL.md", import.meta.url));

describe("skills.sh skill", () => {
  it("has agentskills frontmatter and Code Mode docs for SSH and rmfakecloud", async () => {
    const body = await readFile(skillPath, "utf8");
    expect(basename(dirname(skillPath))).toBe("remarkable-mcp");
    const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
    expect(fm).toBeTruthy();
    expect(fm?.[1]).toMatch(/^name:\s*remarkable-mcp\s*$/m);
    expect(fm?.[1]).toMatch(/^description:\s*.+/m);
    expect(body).toMatch(/10\.11\.99\.1/);
    expect(body).toMatch(/rme\./);
    expect(body).toMatch(/remarkable_execute/);
    expect(body).toMatch(/RMFAKECLOUD/);
    expect(body).not.toMatch(/SSH-only/i);
    expect(body).not.toMatch(/REMARKABLE_TOKEN/);
    expect(body.toLowerCase()).not.toMatch(/connect subscription/);
  });
});
