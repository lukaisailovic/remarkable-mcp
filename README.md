# remarkable-mcp

Give an AI assistant **direct control of your [reMarkable](https://remarkable.com) tablet** — list notes, upload PDFs, export handwriting, write on pages — over SSH.

The assistant gets **one** MCP tool, `remarkable_execute`, and writes a short JavaScript snippet that calls `rme.*` (list, mkdir, write, export, …) in one shot.

| You have | This project is |
| --- | --- |
| A reMarkable with **developer mode** | An [MCP](https://modelcontextprotocol.io) server |
| SSH over USB (`10.11.99.1`) or Wi‑Fi | stdio **or** Streamable HTTP (Docker) |
| Claude / Cursor / VS Code / any MCP client | SFTP into the tablet’s xochitl library |

---

## How it works

```
MCP client                    this process                         tablet
───────────                   ────────────                         ──────
remarkable_execute({          node:vm sandbox                      SSH/SFTP
  code: `async () => {   →    rme.list / rme.mkdir / …      →      /home/root/.local/share/remarkable/xochitl
    await rme.mkdir(…)
    return await rme.list({})
  }`
})
```

1. Enable **Settings → General → Developer mode** on the tablet.
2. SSH in over USB (`root@10.11.99.1`) or Wi‑Fi (IP under About → Copyrights).
3. Run this server. Point your MCP client at it.

---

## Install

```bash
pnpm install
pnpm build
```

Node 22+. [pnpm](https://pnpm.io) is required.

### Local (stdio)

Most desktop MCP clients spawn a process. Add this (Claude Desktop, Cursor, VS Code, …):

```json
{
  "mcpServers": {
    "remarkable": {
      "command": "node",
      "args": ["/absolute/path/to/remarkable-mcp/dist/index.js"],
      "env": {
        "REMARKABLE_HOST": "10.11.99.1",
        "REMARKABLE_USER": "root",
        "REMARKABLE_PASSWORD": "your-tablet-password"
      }
    }
  }
}
```

Prefer a key? Set `REMARKABLE_KEY` to a private-key path (or the PEM). If unset, `~/.ssh/id_ed25519` then `id_rsa` are tried.

### HTTP / Docker

Same server, [Streamable HTTP](https://modelcontextprotocol.io) on `/mcp`:

```bash
pnpm start:http
# → http://127.0.0.1:8080/mcp    health: /health
```

```bash
docker compose up --build
# bind 0.0.0.0:8080, pass REMARKABLE_* in the environment
```

---

## What the model can do

The client only lists **`remarkable_execute`**. Inside the snippet, methods live on **`rme`**.

```js
async () => {
  const folder = await rme.mkdir({ name: "Projects" });
  await rme.createNotebook({ name: "Ideas", parent: folder.id });
  await rme.writeText({ document: "Ideas", text: "Ship it", newPage: true });
  const page = await rme.exportPage({ document: "Ideas", page: 1, format: "png" });
  return { folder: folder.path, page: page.mime };
}
```

Documents resolve by **UUID**, unique **visible name**, or **path** (`/Work/Notes`). Pages are **1-based**. Ink points are **`[x, y]` in 0–1** from the top-left. `remove` moves to **trash**. Writes restart **xochitl** so the UI refreshes.

| `rme.*` | What it does |
| --- | --- |
| `list({ includeTrash?, folder? })` | Library listing (trash hidden by default) |
| `browse({ path? })` | One folder, or a single document |
| `search({ query, tag? })` | Name / path search, optional tag |
| `info({ document })` | Id, path, type, tags, page count |
| `read({ document })` | Text from a PDF or EPUB |
| `download({ document })` | Raw PDF/EPUB as base64 |
| `exportPage({ document, page?, format? })` | Notebook page → `png` or `svg` |
| `upload({ name, dataBase64, parent?, fileType? })` | Put a PDF or EPUB on the tablet |
| `mkdir` / `move` / `rename` / `remove` | Folders and trash |
| `createNotebook` / `addPage` / `removePage` | Native notebooks |
| `writeInk({ document, strokes, page? })` | Pen / highlighter strokes |
| `writeText({ document, text, page?, newPage? })` | Text drawn as fineliner strokes |
| `tag({ document, tag, remove?, page? })` / `tags()` | Document or page tags |
| `refresh()` | Restart xochitl |

---

## Configuration

Flags and env vars are interchangeable (`--host` ≡ `REMARKABLE_HOST`).

| Tablet | Default | |
| --- | --- | --- |
| `REMARKABLE_HOST` / `--host` | `10.11.99.1` | SSH host (USB default) |
| `REMARKABLE_USER` / `--user` | `root` | SSH user |
| `REMARKABLE_PORT` / `--port` | `22` | SSH port |
| `REMARKABLE_PASSWORD` / `--password` | | Password |
| `REMARKABLE_KEY` / `--key` | `~/.ssh/id_ed25519`, then `id_rsa` | Key path or PEM |

| Server | Default | |
| --- | --- | --- |
| `--http` / `MCP_HTTP=1` | off | Streamable HTTP instead of stdio |
| `MCP_HTTP_HOST` / `--http-host` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker) |
| `MCP_HTTP_PORT` / `PORT` / `--http-port` | `8080` | HTTP port |
| `--fake` / `REMARKABLE_FAKE=1` | off | In-memory tablet (tests, no device) |
| `--fake-dir` / `REMARKABLE_FAKE_DIR` | | Local directory treated as a xochitl tree |

---

## Agent skill

Installable with [skills.sh](https://skills.sh):

```bash
npx skills add <this-repo>
```

The skill lives at [`skills/remarkable-mcp/SKILL.md`](skills/remarkable-mcp/SKILL.md).

---

## Develop

```bash
pnpm test
pnpm exec tsx src/index.ts --fake
pnpm exec tsx src/index.ts --fake --http --http-port 8080
```

Tests use a fake tablet filesystem. A live device is never required.

Inspired by [sammorrowdrums/remarkable-mcp](https://github.com/sammorrowdrums/remarkable-mcp) and [itsfabioroma/remarkable-cli](https://github.com/itsfabioroma/remarkable-cli).

MIT. See [LICENSE](LICENSE).
