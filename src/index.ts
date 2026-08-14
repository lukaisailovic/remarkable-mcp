#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createApi } from "./api.js";
import { EXECUTOR_KIND } from "./executor.js";
import { lazyTablet, type OpenConfig } from "./fs.js";
import { startHttp } from "./http.js";
import { createMcpServer } from "./server.js";

export type AppConfig = OpenConfig & {
  http: boolean;
  httpHost: string;
  httpPort: number;
};

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv = process.argv.slice(2),
): AppConfig {
  const arg = (name: string): string | undefined => {
    const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (i < 0) return undefined;
    const cur = argv[i];
    if (cur?.includes("=")) return cur.split("=").slice(1).join("=");
    return argv[i + 1];
  };
  const fakeDir = arg("fake-dir") ?? env.REMARKABLE_FAKE_DIR;
  const fakeFlag =
    argv.includes("--fake") || env.REMARKABLE_FAKE === "1" || env.REMARKABLE_FAKE === "true";
  const httpFlag =
    argv.includes("--http") ||
    env.MCP_HTTP === "1" ||
    env.MCP_HTTP === "true" ||
    env.MCP_TRANSPORT === "http";
  return {
    host: arg("host") ?? env.REMARKABLE_HOST ?? "10.11.99.1",
    user: arg("user") ?? env.REMARKABLE_USER ?? "root",
    port: Number(arg("port") ?? env.REMARKABLE_PORT ?? 22),
    password: arg("password") ?? env.REMARKABLE_PASSWORD,
    key: arg("key") ?? env.REMARKABLE_KEY,
    fake: Boolean(fakeDir) || fakeFlag,
    fakeDir,
    cloudUrl: arg("cloud") ?? env.RMFAKECLOUD_URL,
    cloudToken: arg("token") ?? env.RMFAKECLOUD_TOKEN,
    pair: arg("pair") ?? env.RMFAKECLOUD_PAIR,
    http: httpFlag,
    httpHost: arg("http-host") ?? env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: Number(arg("http-port") ?? env.MCP_HTTP_PORT ?? env.PORT ?? 8080),
  };
}

export function backendName(cfg: AppConfig): string {
  if (cfg.fake || cfg.fakeDir) return "fake";
  if (cfg.cloudUrl) return "rmfakecloud";
  return "ssh";
}

export async function start(cfg = loadConfig()): Promise<void> {
  const api = createApi(lazyTablet(cfg));
  if (cfg.http) {
    const { url } = await startHttp(api, { host: cfg.httpHost, port: cfg.httpPort });
    console.error(
      `remarkable-mcp http ${url} executor=${EXECUTOR_KIND} backend=${backendName(cfg)} tablet=${cfg.host}`,
    );
    return;
  }
  const server = await createMcpServer(api);
  await server.connect(new StdioServerTransport());
  console.error(
    `remarkable-mcp stdio executor=${EXECUTOR_KIND} backend=${backendName(cfg)} host=${cfg.host}`,
  );
}

const entry = process.argv[1]?.replaceAll("\\", "/");
if (
  entry?.endsWith("/src/index.ts") ||
  entry?.endsWith("/dist/index.js") ||
  entry?.endsWith("/index.ts")
) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
