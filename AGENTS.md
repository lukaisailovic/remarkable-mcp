# Agent notes

pnpm, Node 22+, TypeScript ESM (`NodeNext`). Imports end in `.js`. No `enum`s, no constructor parameter properties (`erasableSyntaxOnly`).

**One MCP tool:** `remarkable_execute`. Sandbox global is `rme`, not `codemode`. Do not register a dozen `remarkable_*` tools.

**SSH only.** No cloud, no USB-web (`http://10.11.99.1` as an HTTP API), no `REMARKABLE_TOKEN`. Tablet FS is `/home/root/.local/share/remarkable/xochitl`.

**Do not** `import` from `@cloudflare/codemode` (main entry needs `cloudflare:workers`). HTTP uses `@modelcontextprotocol/sdk` Streamable HTTP.

## Layout

| Path | Role |
| --- | --- |
| `src/api.ts` | Typed tablet API (`createApi`) |
| `src/fs.ts` | `MemoryFs` / `LocalFs` / `SshFs` |
| `src/xochitl.ts` | `.metadata` / `.content` JSON |
| `src/rm.ts` | `.rm` strokes, SVG/PNG |
| `src/pdf.ts` | PDF/EPUB text (`unpdf`, `jszip`) |
| `src/server.ts` | MCP wrap → `remarkable_execute` |
| `src/http.ts` | Streamable HTTP `/mcp` |
| `src/index.ts` | stdio default; `--http` / `MCP_HTTP=1` |

## Conventions that bite

- Resolve **notebooks** by UUID, unique name, or `/Folder/Name`. Pages are **1-based**. Ink points are **0–1** from top-left. `writeText` is native Type Folio and appends.
- `remove` = trash (`parent: "trash"`), not unlink. Writes restart xochitl (`systemctl restart xochitl`).
- Tests: `REMARKABLE_FAKE=1` / `MemoryFs`. Never need a live tablet. `pnpm test` (vitest).
- Skill: `skills/remarkable-mcp/SKILL.md` — `name` must match the directory.

Public docs: `README.md`. Do not put cloud setup in either file.
