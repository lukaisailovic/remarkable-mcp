import { defineConfig } from "rolldown";

export default defineConfig({
  input: "src/index.ts",
  platform: "node",
  external: (id) =>
    id.includes("node_modules") ||
    (!id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0")),
  output: {
    file: "dist/index.js",
    format: "esm",
    sourcemap: true,
  },
});
