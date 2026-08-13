import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Remarkable } from "./api.js";
import { NodeVmExecutor } from "./executor.js";

export const EXECUTE_TOOL = "remarkable_execute";
export const SANDBOX_NS = "rme";

const stroke = z.object({
  points: z.array(z.tuple([z.number(), z.number()])),
  tool: z.enum(["pen", "highlighter"]).optional(),
  color: z.string().optional(),
});

export async function createMcpServer(api: Remarkable): Promise<McpServer> {
  const inner = new McpServer({ name: "remarkable", version: "0.1.0" });
  const tool = (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    annotations: { readOnlyHint?: boolean; destructiveHint?: boolean },
    fn: (args: never) => Promise<unknown>,
  ) => {
    inner.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      const result = await fn(args as never);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    });
  };

  tool("list", "List documents and folders. Trash is hidden unless includeTrash is true.", {
    includeTrash: z.boolean().optional(),
    folder: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.list(a));

  tool("browse", "Browse one folder path (default /). Opening a document returns that item.", {
    path: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.browse(a));

  tool("search", "Search by document name or path, optionally filtered by tag.", {
    query: z.string(),
    tag: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.search(a));

  tool("info", "Detailed info for a document or folder (name, id, path, or unique visibleName).", {
    document: z.string(),
  }, { readOnlyHint: true }, (a) => api.info(a));

  tool("read", "Extract text from a PDF or EPUB on the tablet.", {
    document: z.string(),
    page: z.number().optional(),
  }, { readOnlyHint: true }, (a) => api.read(a));

  tool("download", "Download the raw PDF or EPUB as base64.", {
    document: z.string(),
  }, { readOnlyHint: true }, (a) => api.download(a));

  tool("exportPage", "Render a notebook page to PNG or SVG (base64).", {
    document: z.string(),
    page: z.number().optional(),
    format: z.enum(["png", "svg"]).optional(),
  }, { readOnlyHint: true }, (a) => api.exportPage(a));

  tool("upload", "Upload a PDF or EPUB (base64) into a folder.", {
    name: z.string(),
    dataBase64: z.string(),
    parent: z.string().optional(),
    fileType: z.enum(["pdf", "epub"]).optional(),
  }, { readOnlyHint: false }, (a) => api.upload(a));

  tool("mkdir", "Create a folder.", {
    name: z.string(),
    parent: z.string().optional(),
  }, { readOnlyHint: false }, (a) => api.mkdir(a));

  tool("move", "Move a document or folder into another folder (use folder: \"/\" for root).", {
    document: z.string(),
    folder: z.string(),
  }, { readOnlyHint: false }, (a) => api.move(a));

  tool("rename", "Rename a document or folder.", {
    document: z.string(),
    name: z.string(),
  }, { readOnlyHint: false }, (a) => api.rename(a));

  tool("remove", "Move a document or folder to trash.", {
    document: z.string(),
  }, { readOnlyHint: false, destructiveHint: true }, (a) => api.remove(a));

  tool("createNotebook", "Create a blank notebook with one page.", {
    name: z.string(),
    parent: z.string().optional(),
  }, { readOnlyHint: false }, (a) => api.createNotebook(a));

  tool("addPage", "Append (or insert after N) a blank notebook page.", {
    document: z.string(),
    after: z.number().optional(),
  }, { readOnlyHint: false }, (a) => api.addPage(a));

  tool("removePage", "Delete a 1-based notebook page.", {
    document: z.string(),
    page: z.number(),
  }, { readOnlyHint: false, destructiveHint: true }, (a) => api.removePage(a));

  tool("writeInk", "Append pen/highlighter strokes. Points are normalized [0,1] from the page top-left.", {
    document: z.string(),
    strokes: z.array(stroke),
    page: z.number().optional(),
  }, { readOnlyHint: false }, (a) => api.writeInk(a));

  tool("writeText", "Write text as fineliner strokes. Use newPage to append a page first.", {
    document: z.string(),
    text: z.string(),
    page: z.number().optional(),
    newPage: z.boolean().optional(),
  }, { readOnlyHint: false }, (a) => api.writeText(a));

  tool("tag", "Add or remove a document tag (or a page tag when page is set).", {
    document: z.string(),
    tag: z.string(),
    remove: z.boolean().optional(),
    page: z.number().optional(),
  }, { readOnlyHint: false }, (a) => api.tag(a));

  tool("tags", "List every tag used on the tablet.", {}, { readOnlyHint: true }, () => api.tags());

  tool("refresh", "Restart xochitl so the tablet UI reloads the library.", {}, { readOnlyHint: false }, () => api.refresh());

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await inner.connect(serverTransport);
  const client = new Client({ name: "rme-proxy", version: "0.1.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  const fns: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const t of tools) {
    const name = t.name;
    fns[name] = async (args) => unwrap(await client.callTool({ name, arguments: (args ?? {}) as Record<string, unknown> }));
  }
  const methods = tools.map((t) => `  ${t.name}(args): Promise<unknown>; // ${t.description ?? ""}`).join("\n");
  const executor = new NodeVmExecutor();
  const outer = new McpServer({ name: "remarkable-mcp", version: "0.1.0" });
  outer.registerTool(EXECUTE_TOOL, {
    description: `Run JavaScript against the SSH-only reMarkable API.

declare const ${SANDBOX_NS}: {
${methods}
};

Write an async arrow function. No TypeScript syntax.
Example: async () => { const docs = await ${SANDBOX_NS}.list({}); return docs; }`,
    inputSchema: { code: z.string().describe("JavaScript async arrow function to execute") },
  }, async ({ code }) => {
    const result = await executor.execute(code, [{ name: SANDBOX_NS, fns }]);
    if (result.error) {
      return { content: [{ type: "text" as const, text: `Error: ${result.error}` }], isError: true };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(result.result, null, 2) ?? "null" }] };
  });
  return outer;
}

function unwrap(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }>; structuredContent?: unknown };
  if (r.structuredContent != null) return r.structuredContent;
  const text = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
  if (r.isError) throw new Error(text || "tool failed");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
