import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Remarkable } from "./api.js";
import { createMcpServer } from "./server.js";

export type HttpOptions = {
  host: string;
  port: number;
  allowedHosts?: string[];
};

export async function startHttp(
  api: Remarkable,
  opts: HttpOptions,
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createMcpExpressApp({
    host: opts.host,
    allowedHosts: opts.allowedHosts,
  });
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const handle = async (req: Request, res: Response) => {
    const sid = req.headers["mcp-session-id"];
    if (typeof sid === "string" && sessions.has(sid)) {
      await sessions.get(sid)!.handleRequest(req, res, req.body);
      return;
    }
    if (!sid && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      const server = await createMcpServer(api);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }
    res
      .status(400)
      .json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Bad Request: missing session" },
        id: null,
      });
  };

  app.post("/mcp", (req, res) => void handle(req, res));
  app.get("/mcp", (req, res) => void handle(req, res));
  app.delete("/mcp", (req, res) => void handle(req, res));
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  const httpServer = await new Promise<ReturnType<typeof app.listen>>((resolve, reject) => {
    const s = app.listen(opts.port, opts.host, (err?: Error) => (err ? reject(err) : resolve(s)));
  });

  const addr = httpServer.address() as AddressInfo;
  const host = addr.address === "::" || addr.address === "0.0.0.0" ? "127.0.0.1" : addr.address;
  return {
    url: `http://${host}:${addr.port}/mcp`,
    close: async () => {
      for (const t of sessions.values()) await t.close();
      sessions.clear();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
