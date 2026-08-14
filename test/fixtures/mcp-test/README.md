# mcp-test fixtures

Hash-tree dump of `/mcp-test` from a live rmfakecloud that a tablet already opened.

- `/mcp-test/Welcome` — 2 pages (title + checklist), tags `mcp` / `test`
- `/mcp-test/Diagram` — mermaid ink (no Type Folio text)
- `/mcp-test/Nested/Inside` — nested notebook

`sync/` is the blob store (`root` + hashes). `manifest.json` lists the documents. `pnpm test` and `pnpm test:e2e` both read this dump.
