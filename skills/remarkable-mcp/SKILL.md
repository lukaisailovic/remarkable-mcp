---
name: remarkable-mcp
description: >
  How to use the remarkable-mcp server: call remarkable_execute with JavaScript
  that uses rme.* to list, read, write, upload, and organize reMarkable
  notebooks. Use when the user mentions reMarkable, tablet notes, xochitl,
  e-ink, Type Folio, uploading a PDF/EPUB, exporting handwriting, drawing
  Mermaid on the tablet, or managing folders/tags. Use when the user runs
  /remarkable-mcp.
---

# remarkable-mcp

The client exposes **one** tool: `remarkable_execute`. Pass a JavaScript **async arrow function**. Methods live on **`rme`**. No TypeScript. No `process` / `require` / `fetch`.

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
  return await rme.read({ notebook: "Ideas", page: 2 });
};
```

Batch related work in **one** call. Writes apply once after the function returns (SSH restarts xochitl; rmfakecloud commits sync). Do not call `refresh()` unless you need an extra apply mid-script. Return only what the user asked for.

## Resolve

- **notebook** (also used for folders, PDFs, EPUBs): UUID, unique visible name, or `/Folder/Name`. Duplicate names throw `ambiguous name`.
- **page**: 1-based. Write defaults: last page. `exportPage` defaults to page 1.
- Ink points: `[x, y]` in **0–1** from the **top-left**.
- `remove` = trash (`parent: "trash"`), not unlink.

`Item`: `{ id, name, type, fileType, parent, path, pageCount, tags, lastModified, trashed, page?, pages? }`. `type` is `notebook` | `folder` | `pdf` | `epub`.

Page writes (`writeText` / `writeInk` / `writeMermaid` / `addPage` / `removePage` / `exportPage`) are for **notebooks**. PDFs/EPUBs have no ink pages — `read` extracts text, `download` returns bytes.

Handwriting is **not OCR'd**. Typed Type Folio text is in `read`. Ink is in `exportPage`.

`search` matches **name/path** (optional tag), not page text. To find content, `list`/`browse` then `read`.

## Discover

| Call         | Args                         | Returns                                                                                 |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------- |
| `rme.list`   | `{ includeTrash?, folder? }` | Library. Trash hidden unless `includeTrash`. `folder` limits to that folder's children. |
| `rme.browse` | `{ path? }`                  | One folder (default `/`). A notebook path returns that single item.                     |
| `rme.search` | `{ query, tag? }`            | Name/path substring. `tag` is an extra filter.                                          |
| `rme.info`   | `{ notebook }`               | One item. Notebooks include `pages[].title` (first title/heading, else first line).     |
| `rme.tags`   | `{}`                         | Sorted unique tag names on the tablet.                                                  |

## Read

| Call             | Args                           | Returns                                                                                                                                                      |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `rme.read`       | `{ notebook, page? }`          | Notebook: typed paragraphs + checkbox state. Omit `page` for every page (`text` joined, plus `pages[]`). PDF/EPUB: extracted document text (`page` ignored). |
| `rme.download`   | `{ notebook }`                 | `{ name, mime, base64 }` for PDF/EPUB only.                                                                                                                  |
| `rme.exportPage` | `{ notebook, page?, format? }` | Ink → `{ mime, page, base64 }`. `format`: `png` (default) or `svg`. **Does not draw typed text.**                                                            |

Paragraphs: `{ text, style, checked? }` with `style` `title` \| `heading` \| `body` \| `bullet` \| `checkbox`.

## Library

| Call                 | Args                                       | Notes                                                                                                                                                 |
| -------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rme.mkdir`          | `{ name, parent? }`                        | Create folder. `parent` omitted = root.                                                                                                               |
| `rme.createNotebook` | `{ name, parent? }`                        | Blank notebook with **one** page.                                                                                                                     |
| `rme.addPage`        | `{ notebook, after? }`                     | Append, or insert after 1-based `after`. Returns `page` (new number).                                                                                 |
| `rme.removePage`     | `{ notebook, page }`                       | Delete that page.                                                                                                                                     |
| `rme.move`           | `{ notebook, folder }`                     | `folder: "/"` is root. Works on notebooks and folders.                                                                                                |
| `rme.rename`         | `{ notebook, name }`                       | Visible name.                                                                                                                                         |
| `rme.remove`         | `{ notebook }`                             | Trash. Still listed with `includeTrash: true`.                                                                                                        |
| `rme.upload`         | `{ name, dataBase64, parent?, fileType? }` | PDF or EPUB. Put the bytes in `dataBase64` inside the snippet — the sandbox cannot read disk or fetch. `fileType` sniffed from name/bytes if omitted. |
| `rme.tag`            | `{ notebook, tag, remove?, page? }`        | Document tag, or page tag when `page` is set.                                                                                                         |
| `rme.refresh`        | `{}`                                       | Apply now. Cloud also pulls if the sync generation moved. Usually unnecessary — execute already flushes.                                              |

## Write

### `rme.writeText`

Native Type Folio text. **Appends** as new paragraphs. Repeated calls stack.

```
{ notebook, text?, style?, checked?, blocks?, page?, newPage?, replace? }
```

- Require `text` or `blocks`.
- `style`: `title` (big), `heading`, `body` (default, small), `bullet`, `checkbox`.
- `checked: true` ticks a checkbox. Newlines in `text` become separate paragraphs of the same style.
- `blocks`: mixed styles in one call: `{ text, style?, checked? }[]`.
- `newPage: true` appends a blank page, then writes there.
- `replace: true` overwrites **typed** text on that page. Ink stays.

### `rme.writeInk`

```
{ notebook, strokes, page? }
```

Each stroke: `{ points: [x, y][], tool?: "pen" | "highlighter", color?: "black" | "gray" | "white" }`. Appends ink. Default page = last.

### `rme.writeMermaid`

```
{ notebook, mermaid, page? }
```

Renders to SVG then ink. Supported: flowchart, sequence, state, class, ER, xychart. `pie` / `gantt` / others throw. A mermaid code fence around the source is accepted.

## Recipes

Read a notebook (typed + handwriting):

```js
async () => {
  const info = await rme.info({ notebook: "Journal" });
  const typed = await rme.read({ notebook: "Journal" });
  const ink = await rme.exportPage({ notebook: "Journal", page: 1, format: "png" });
  return { info, typed, ink };
};
```

Checklist on a new page:

```js
async () => {
  return await rme.writeText({
    notebook: "/Work/Standup",
    newPage: true,
    blocks: [
      { text: "Monday", style: "title" },
      { text: "Ship the MCP skill", style: "checkbox" },
      { text: "Already done", style: "checkbox", checked: true },
    ],
  });
};
```

Upload a PDF (base64 must be in the snippet):

```js
async () => {
  return await rme.upload({
    name: "Q1.pdf",
    dataBase64: "JVBERi0x...",
    parent: "Work",
    fileType: "pdf",
  });
};
```
