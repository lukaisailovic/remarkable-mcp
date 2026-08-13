import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXECUTE_TOOL } from "../src/server.js";

const root = fileURLToPath(new URL("..", import.meta.url));

async function launch(): Promise<{
  tools: string[];
  names: string[];
  stderr: string;
  close: () => Promise<void>;
}> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/index.ts", "--fake"],
    cwd: root,
    env: { REMARKABLE_FAKE: "1" },
    stderr: "pipe",
  });
  const chunks: Buffer[] = [];
  const err = transport.stderr;
  err?.on("data", (c: Buffer) => chunks.push(c));
  const client = new Client({ name: "launch-test", version: "0.0.0" });
  await client.connect(transport);
  const listed = await client.listTools();
  const result = await client.callTool({
    name: EXECUTE_TOOL,
    arguments: {
      code: `async () => {
        const before = await rme.list({});
        await rme.mkdir({ name: "LaunchFolder" });
        const after = await rme.list({});
        return { before: before.map(i => i.name), after: after.map(i => i.name) };
      }`,
    },
  });
  const text = (result.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
  const parsed = JSON.parse(text) as { after: string[] };
  return {
    tools: listed.tools.map((t) => t.name),
    names: parsed.after,
    stderr: Buffer.concat(chunks).toString(),
    close: async () => {
      await client.close();
    },
  };
}

describe("stdio MCP entry", () => {
  it("exposes remarkable_execute and mkdir is visible after two fresh launches", async () => {
    const first = await launch();
    try {
      expect(first.tools).toEqual(["remarkable_execute"]);
      expect(first.names).toContain("LaunchFolder");
      expect(first.stderr).toMatch(/executor=node:vm/);
    } finally {
      await first.close();
    }

    const second = await launch();
    try {
      expect(second.tools).toEqual(["remarkable_execute"]);
      expect(second.names).toContain("LaunchFolder");
    } finally {
      await second.close();
    }
  });
});
