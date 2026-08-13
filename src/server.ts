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

const textStyle = z.enum(["title", "heading", "body", "bullet", "checkbox"]);
const block = z.object({
  text: z.string(),
  style: textStyle.optional(),
  checked: z.boolean().optional(),
});
const notebook = z.string().describe("Notebook, PDF, EPUB, or folder: UUID, unique name, or /Folder/Name");

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

  tool("list", "List notebooks, PDFs, EPUBs, and folders. Trash is hidden unless includeTrash is true.", {
    includeTrash: z.boolean().optional(),
    folder: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.list(a));

  tool("browse", "Browse one folder path (default /). Opening a notebook returns that item.", {
    path: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.browse(a));

  tool("search", "Search by notebook name or path, optionally filtered by tag.", {
    query: z.string(),
    tag: z.string().optional(),
  }, { readOnlyHint: true }, (a) => api.search(a));

  tool("info", "Notebook/folder/PDF info. Notebooks include pages[].title from the first typed line.", {
    notebook,
  }, { readOnlyHint: true }, (a) => api.info(a));

  tool("read", "Read a notebook page (native paragraphs + checkbox state). Omit page to read every page. PDFs/EPUBs return extracted text.", {
    notebook,
    page: z.number().optional(),
  }, { readOnlyHint: true }, (a) => api.read(a));

  tool("download", "Download the raw PDF or EPUB as base64.", {
    notebook,
  }, { readOnlyHint: true }, (a) => api.download(a));

  tool("exportPage", "Render ink on a notebook page to PNG or SVG (base64). Does not render typed text.", {
    notebook,
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

  tool("move", "Move a notebook or folder into another folder (folder: \"/\" for root).", {
    notebook,
    folder: z.string(),
  }, { readOnlyHint: false }, (a) => api.move(a));

  tool("rename", "Rename a notebook or folder.", {
    notebook,
    name: z.string(),
  }, { readOnlyHint: false }, (a) => api.rename(a));

  tool("remove", "Move a notebook or folder to trash.", {
    notebook,
  }, { readOnlyHint: false, destructiveHint: true }, (a) => api.remove(a));

  tool("createNotebook", "Create a blank notebook with one page.", {
    name: z.string(),
    parent: z.string().optional(),
  }, { readOnlyHint: false }, (a) => api.createNotebook(a));

  tool("addPage", "Append (or insert after N) a blank notebook page. Returns the new 1-based page number.", {
    notebook,
    after: z.number().optional(),
  }, { readOnlyHint: false }, (a) => api.addPage(a));

  tool("removePage", "Delete a 1-based notebook page.", {
    notebook,
    page: z.number(),
  }, { readOnlyHint: false, destructiveHint: true }, (a) => api.removePage(a));

  tool("writeInk", "Append pen/highlighter strokes to a page. Points are [x,y] in 0–1 from the top-left.", {
    notebook,
    strokes: z.array(stroke),
    page: z.number().optional(),
  }, { readOnlyHint: false }, (a) => api.writeInk(a));

  tool("writeText", "Append native Type Folio text to a notebook page (default: last page). style: title (big), heading, body (small), bullet, checkbox. checked:true ticks a checkbox. blocks: mixed styles in one call. replace:true overwrites typed text (ink stays). newPage:true adds a blank page first. Repeated calls stack as new paragraphs.", {
    notebook,
    text: z.string().optional(),
    style: textStyle.optional(),
    checked: z.boolean().optional(),
    blocks: z.array(block).optional(),
    page: z.number().optional(),
    newPage: z.boolean().optional(),
    replace: z.boolean().optional(),
  }, { readOnlyHint: false }, (a) => api.writeText(a));

  tool("tag", "Add or remove a notebook tag (or a page tag when page is set).", {
    notebook,
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
