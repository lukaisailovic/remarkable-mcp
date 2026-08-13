---
name: remarkable-mcp
description: Control a reMarkable tablet over SSH only via the remarkable-mcp Code Mode server. Use when the user mentions reMarkable, tablet notes, xochitl, e-ink notebooks, uploading PDFs to the tablet, exporting handwritten pages, or managing folders/tags on the device.
---

# remarkable-mcp

SSH-only MCP server. No cloud account, no USB web interface.

The client sees one tool: `remarkable_execute`. Sandbox methods live on `rme`.

## Install the server

```bash
pnpm install
pnpm build
```

### stdio (local clients)

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

### Streamable HTTP (Docker / remote)

```bash
node dist/index.js --http --http-host 0.0.0.0 --http-port 8080
# or
docker compose up --build
```

Point the client at `http://127.0.0.1:8080/mcp`.

Or a key instead of a password: `REMARKABLE_KEY` = path to a private key (or the PEM itself). Defaults: `root@10.11.99.1:22`, then `~/.ssh/id_ed25519` / `id_rsa`.

Enable developer mode on the tablet first (Settings → General → Developer). USB address is always `10.11.99.1`. Wi‑Fi IP is under About → Copyrights.

Fake tablet (tests / no device): `REMARKABLE_FAKE=1` or `--fake`.

## How to call it

Call `remarkable_execute` with a JavaScript async arrow function. Use `rme`.

```js
async () => {
  const docs = await rme.list({});
  const folder = await rme.mkdir({ name: "Projects" });
  await rme.createNotebook({ name: "Ideas", parent: folder.id });
  await rme.writeText({ document: "Ideas", text: "Ship it", style: "title", newPage: true });
  const page = await rme.exportPage({ document: "Ideas", page: 1, format: "png" });
  return { docs, page: page.mime };
}
```

Useful calls:

- `rme.list({ includeTrash?, folder? })` / `rme.browse({ path? })` / `rme.search({ query, tag? })` / `rme.info({ document })`
- `rme.read({ document, page? })` PDF/EPUB text, or native Type Folio text on a notebook page; `rme.download({ document })` raw base64
- `rme.exportPage({ document, page?, format? })` PNG or SVG
- `rme.upload({ name, dataBase64, parent?, fileType? })`
- `rme.mkdir` / `rme.move` / `rme.rename` / `rme.remove` (trash)
- `rme.createNotebook` / `rme.addPage` / `rme.removePage`
- `rme.writeInk({ document, strokes, page? })` points are `[x,y]` in 0–1
- `rme.writeText({ document, text, page?, newPage?, style? })` — `style: "title"|"heading"|"body"` is the on-device Aa menu (big/small). Omit style for ink glyphs.
- `rme.tag({ document, tag, remove?, page? })` / `rme.tags()`
- `rme.refresh()` restarts xochitl

Writes restart the UI. Resolve documents by UUID, unique name, or path (`/Work/Notes`).

## Transport

SSH/SFTP to the xochitl tree only. Do not configure cloud tokens or the USB web UI.
