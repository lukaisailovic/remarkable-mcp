import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import { MemoryFs } from "../src/fs.js";
import { startHttp } from "../src/http.js";
import { EXECUTE_TOOL } from "../src/server.js";

describe("streamable HTTP transport", () => {
  it("serves remarkable_execute over /mcp and runs rme.mkdir", async () => {
    const { url, close } = await startHttp(createApi(new MemoryFs()), {
      host: "127.0.0.1",
      port: 0,
    });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "http-test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual([EXECUTE_TOOL]);
      const result = await client.callTool({
        name: EXECUTE_TOOL,
        arguments: {
          code: `async () => {
            await rme.mkdir({ name: "LaunchFolder" });
            return (await rme.list({})).map(i => i.name);
          }`,
        },
      });
      const text = (result.content as { type: string; text?: string }[])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("");
      expect(text).toContain("LaunchFolder");
    } finally {
      await client.close();
      await close();
    }
  });
});
