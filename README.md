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
  await rme.writeText({
    notebook: "Ideas",
    newPage: true,
    blocks: [
      { text: "Ship it", style: "title" },
      { text: "Talk to design", style: "checkbox" },
    ],
  });
  await rme.writeText({ notebook: "Ideas", text: "Write the RFC", style: "checkbox" });
  return await rme.read({ notebook: "Ideas", page: 2 });
}
```

A **notebook** is the file (name, path `/Work/Notes`, or UUID). A **page** is 1-based inside that notebook. `writeText` always writes native Type Folio text and **appends** — call it again to stack more paragraphs. Ink points are **`[x, y]` in 0–1** from the top-left. `remove` moves to **trash**. Writes restart **xochitl** so the UI refreshes.

| `rme.*` | What it does |
| --- | --- |
| `list({ includeTrash?, folder? })` | Library listing (trash hidden by default) |
| `browse({ path? })` | One folder, or a single notebook |
| `search({ query, tag? })` | Name / path search, optional tag |
| `info({ notebook })` | Id, path, type, tags, page count, `pages[].title` |
| `read({ notebook, page? })` | Native paragraphs (and checkbox state), or all pages if `page` is omitted. PDF/EPUB text. |
| `download({ notebook })` | Raw PDF/EPUB as base64 |
| `exportPage({ notebook, page?, format? })` | Ink on a page → `png` or `svg` (typed text is not drawn) |
| `upload({ name, dataBase64, parent?, fileType? })` | Put a PDF or EPUB on the tablet |
| `mkdir` / `move` / `rename` / `remove` | Folders and trash |
| `createNotebook` / `addPage` / `removePage` | Notebooks and pages |
| `writeInk({ notebook, strokes, page? })` | Pen / highlighter strokes |
| `writeText({ notebook, text?, style?, checked?, blocks?, page?, newPage?, replace? })` | Native Type Folio: `title` `heading` `body` `bullet` `checkbox`. Stacks unless `replace`. |
| `tag({ notebook, tag, remove?, page? })` / `tags()` | Notebook or page tags |
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
