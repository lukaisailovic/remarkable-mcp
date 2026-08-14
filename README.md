# remarkable-mcp

Give an AI assistant **direct control of your [reMarkable](https://remarkable.com) tablet** — list notes, upload PDFs, export handwriting, write on pages — over SSH or [rmfakecloud](https://github.com/ddvk/rmfakecloud).

The assistant gets **one** MCP tool, `remarkable_execute`, and writes a short JavaScript snippet that calls `rme.*` (list, mkdir, write, export, …) in one shot.

| You have                                          | This project is                                  |
| ------------------------------------------------- | ------------------------------------------------ |
| A reMarkable with **developer mode**              | An [MCP](https://modelcontextprotocol.io) server |
| SSH (USB `10.11.99.1` / Wi‑Fi) **or** rmfakecloud | stdio **or** Streamable HTTP (Docker)            |
| Claude / Cursor / VS Code / any MCP client        | Same `rme.*` on either storage backend           |

---

## How it works

```
MCP client                    this process                         storage
───────────                   ────────────                         ───────
remarkable_execute({          node:vm sandbox                      SSH → xochitl
  code: `async () => {   →    rme.list / rme.mkdir / …      →      or rmfakecloud sync v3
    await rme.mkdir(…)
    return await rme.list({})
  }`
})
```

Default is SSH into the tablet. rmfakecloud is opt-in (`RMFAKECLOUD_URL` + device token).

1. Enable **Settings → General → Developer mode** on the tablet (SSH).
2. SSH over USB (`root@10.11.99.1`) or Wi‑Fi — **or** pair with your rmfakecloud.
3. Run this server. Point your MCP client at it.

---

## Install

Node 22+. No clone required.

### Claude Desktop, Cursor, VS Code, …

```json
{
  "mcpServers": {
    "remarkable": {
      "command": "npx",
      "args": ["-y", "@lukaisailovic/remarkable-mcp"],
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

### rmfakecloud

Same `rme.*`, sync-v3 instead of SFTP. Pair once, save the device token:

```json
{
  "mcpServers": {
    "remarkable": {
      "command": "npx",
      "args": ["-y", "@lukaisailovic/remarkable-mcp"],
      "env": {
        "RMFAKECLOUD_URL": "https://cloud.example",
        "RMFAKECLOUD_TOKEN": "device-jwt-from-pair"
      }
    }
  }
}
```

First pair: `npx -y @lukaisailovic/remarkable-mcp --cloud https://cloud.example --pair ABCDEFGH` (code from the rmfakecloud UI). It prints a device token to stderr. Writes commit the hash tree; the tablet picks them up on next Check Sync. Not official reMarkable Cloud.

### HTTP

Same server, [Streamable HTTP](https://modelcontextprotocol.io) on `/mcp`:

```bash
npx -y @lukaisailovic/remarkable-mcp --http
# → http://127.0.0.1:8080/mcp    health: /health
```

Or pull the image from GHCR:

```bash
docker run --rm -p 8080:8080 \
  -e REMARKABLE_HOST=10.11.99.1 \
  -e REMARKABLE_PASSWORD=your-tablet-password \
  ghcr.io/lukaisailovic/remarkable-mcp:latest
```

From a clone: `docker compose up --build` (bind `0.0.0.0:8080`, pass `REMARKABLE_*`).

A local checkout’s `.mcp.json` watches `src/` and restarts the stdio child on save (no client restart). `pnpm dev:http` does the same for Streamable HTTP. In Grok, `/mcps` disable+enable respawns the process; `r` only refreshes the list.

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
};
```

A **notebook** is the file (name, path `/Work/Notes`, or UUID). A **page** is 1-based inside that notebook. `writeText` always writes native Type Folio text and **appends** — call it again to stack more paragraphs. Ink points are **`[x, y]` in 0–1** from the top-left. `remove` moves to **trash**. Writes apply once after the tool returns: SSH restarts **xochitl**; rmfakecloud commits the sync tree.

| `rme.*`                                                                                | What it does                                                                              |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `list({ includeTrash?, folder? })`                                                     | Library listing (trash hidden by default)                                                 |
| `browse({ path? })`                                                                    | One folder, or a single notebook                                                          |
| `search({ query, tag? })`                                                              | Name / path search, optional tag                                                          |
| `info({ notebook })`                                                                   | Id, path, type, tags, page count, `pages[].title`                                         |
| `read({ notebook, page? })`                                                            | Native paragraphs (and checkbox state), or all pages if `page` is omitted. PDF/EPUB text. |
| `download({ notebook })`                                                               | Raw PDF/EPUB as base64                                                                    |
| `exportPage({ notebook, page?, format? })`                                             | Ink on a page → `png` or `svg` (typed text is not drawn)                                  |
| `upload({ name, dataBase64, parent?, fileType? })`                                     | Put a PDF or EPUB on the tablet                                                           |
| `mkdir` / `move` / `rename` / `remove`                                                 | Folders and trash                                                                         |
| `createNotebook` / `addPage` / `removePage`                                            | Notebooks and pages                                                                       |
| `writeInk({ notebook, strokes, page? })`                                               | Pen / highlighter strokes                                                                 |
| `writeMermaid({ notebook, mermaid, page? })`                                           | Mermaid → ink (flowchart, sequence, state, class, ER, xychart)                            |
| `writeText({ notebook, text?, style?, checked?, blocks?, page?, newPage?, replace? })` | Native Type Folio: `title` `heading` `body` `bullet` `checkbox`. Stacks unless `replace`. |
| `tag({ notebook, tag, remove?, page? })` / `tags()`                                    | Notebook or page tags                                                                     |
| `refresh()`                                                                            | Apply now (SSH: restart xochitl; cloud: commit)                                           |

---

## Configuration

Flags and env vars are interchangeable (`--host` ≡ `REMARKABLE_HOST`).

| Tablet                               | Default                            |                        |
| ------------------------------------ | ---------------------------------- | ---------------------- |
| `REMARKABLE_HOST` / `--host`         | `10.11.99.1`                       | SSH host (USB default) |
| `REMARKABLE_USER` / `--user`         | `root`                             | SSH user               |
| `REMARKABLE_PORT` / `--port`         | `22`                               | SSH port               |
| `REMARKABLE_PASSWORD` / `--password` |                                    | Password               |
| `REMARKABLE_KEY` / `--key`           | `~/.ssh/id_ed25519`, then `id_rsa` | Key path or PEM        |

| rmfakecloud                     | Default |                                  |
| ------------------------------- | ------- | -------------------------------- |
| `RMFAKECLOUD_URL` / `--cloud`   |         | Base URL of your rmfakecloud     |
| `RMFAKECLOUD_TOKEN` / `--token` |         | Device JWT from a prior `--pair` |
| `RMFAKECLOUD_PAIR` / `--pair`   |         | One-shot 8-letter pairing code   |

| Server                                   | Default     |                                           |
| ---------------------------------------- | ----------- | ----------------------------------------- |
| `--http` / `MCP_HTTP=1`                  | off         | Streamable HTTP instead of stdio          |
| `MCP_HTTP_HOST` / `--http-host`          | `127.0.0.1` | Bind address (`0.0.0.0` in Docker)        |
| `MCP_HTTP_PORT` / `PORT` / `--http-port` | `8080`      | HTTP port                                 |
| `--fake` / `REMARKABLE_FAKE=1`           | off         | In-memory tablet (tests, no device)       |
| `--fake-dir` / `REMARKABLE_FAKE_DIR`     |             | Local directory treated as a xochitl tree |

---

## Agent skill

Installable with [skills.sh](https://skills.sh):

```bash
npx skills add lukaisailovic/remarkable-mcp
```

The skill lives at [`skills/remarkable-mcp/SKILL.md`](skills/remarkable-mcp/SKILL.md).

---

## Develop

```bash
pnpm test
pnpm test:e2e
pnpm lint
pnpm fmt
pnpm build
pnpm exec tsx src/index.ts --fake
pnpm exec tsx src/index.ts --fake --http --http-port 8080
```

`pnpm test` uses an in-memory tablet and a mock sync-v3 server. A live device is never required.

`pnpm test:e2e` starts [rmfakecloud](https://github.com/ddvk/rmfakecloud) via `docker-compose-test.yml`, pairs, writes a notebook, and reads it back from a second client. Needs Docker. Override the URL with `RMFAKECLOUD_E2E_URL` to point at an already-running server.

Inspired by [sammorrowdrums/remarkable-mcp](https://github.com/sammorrowdrums/remarkable-mcp) and [itsfabioroma/remarkable-cli](https://github.com/itsfabioroma/remarkable-cli).

MIT. See [LICENSE](LICENSE).
