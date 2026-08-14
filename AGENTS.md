# Agent notes

pnpm, Node 22+, TypeScript ESM (`NodeNext`). Imports end in `.js`. No `enum`s, no constructor parameter properties (`erasableSyntaxOnly`).

**One MCP tool:** `remarkable_execute`. Sandbox global is `rme`, not `codemode`. Do not register a dozen `remarkable_*` tools.

**Storage:** SSH into xochitl (default) or rmfakecloud sync v3 (`RMFAKECLOUD_URL` + device token / `--pair`). No official reMarkable Cloud (`my.remarkable.com`, `REMARKABLE_TOKEN`), no USB-web (`http://10.11.99.1` as an HTTP API). Tablet FS path for SSH is `/home/root/.local/share/remarkable/xochitl`.

**Do not** `import` from `@cloudflare/codemode` (main entry needs `cloudflare:workers`). HTTP uses `@modelcontextprotocol/sdk` Streamable HTTP.

## Layout

| Path             | Role                                         |
| ---------------- | -------------------------------------------- |
| `src/api.ts`     | Typed tablet API (`createApi`)               |
| `src/fs.ts`      | `MemoryFs` / `LocalFs` / `SshFs` + `apply()` |
| `src/cloud.ts`   | rmfakecloud sync v3 (`CloudFs`)              |
| `src/xochitl.ts` | `.metadata` / `.content` JSON                |
| `src/rm.ts`      | `.rm` strokes, SVG/PNG                       |
| `src/mermaid.ts` | Mermaid → SVG (`beautiful-mermaid`) → ink    |
| `src/pdf.ts`     | PDF/EPUB text (`unpdf`, `jszip`)             |
| `src/server.ts`  | MCP wrap → `remarkable_execute`              |
| `src/http.ts`    | Streamable HTTP `/mcp`                       |
| `src/index.ts`   | stdio default; `--http` / `MCP_HTTP=1`       |

## Conventions that bite

- Resolve **notebooks** by UUID, unique name, or `/Folder/Name`. Pages are **1-based**. Ink points are **0–1** from top-left. `writeText` is native Type Folio and appends.
- `remove` = trash (`parent: "trash"`), not unlink. Writes `apply()` once per tool call (SSH: restart xochitl; cloud: PUT blobs + `/sync/v3/root`).
- Tests: `REMARKABLE_FAKE=1` / `MemoryFs`. Never need a live tablet. `pnpm test` (vitest). Optional `pnpm test:e2e` (Docker rmfakecloud). Lint/fmt/build: `oxlint`, `oxfmt`, `rolldown`.
- Local `.mcp.json` runs `src/dev-stdio.ts`: saving `src/*.ts` restarts the MCP child; Grok stays up. `/mcps` disable+enable also respawns. `r` in `/mcps` only refreshes the list.
- Skill: `skills/remarkable-mcp/SKILL.md` — `name` must match the directory.

Public docs: `README.md`. Document both SSH and rmfakecloud. Not official reMarkable Cloud.
