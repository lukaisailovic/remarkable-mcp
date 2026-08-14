#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** stdio supervisor: keep Grok's pipe, restart the MCP child when src/ changes. */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const childArgs = ["--env-file=.env", "--import", "tsx", join(here, "index.ts")];

let child: ChildProcess | undefined;
let gen = 0;
const handshake: string[] = [];
let ready = false;
let debounce: ReturnType<typeof setTimeout> | undefined;

function start(replay: boolean): void {
  const my = ++gen;
  child?.kill();
  const proc = spawn(process.execPath, childArgs, {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
  });
  child = proc;
  let dropFirst = replay;
  let acc = "";
  proc.stdout?.setEncoding("utf8");
  proc.stdout?.on("data", (s: string) => {
    if (!dropFirst) {
      process.stdout.write(s);
      return;
    }
    acc += s;
    const i = acc.indexOf("\n");
    if (i < 0) return;
    process.stdout.write(acc.slice(i + 1));
    acc = "";
    dropFirst = false;
  });
  proc.on("exit", (code) => {
    if (my !== gen) return;
    if (ready) start(true);
    else process.exit(code ?? 1);
  });
  if (replay) for (const line of handshake) proc.stdin?.write(line);
}

process.stdin.setEncoding("utf8");
let inbuf = "";
process.stdin.on("data", (s: string) => {
  inbuf += s;
  let i = inbuf.indexOf("\n");
  while (i >= 0) {
    const line = inbuf.slice(0, i + 1);
    inbuf = inbuf.slice(i + 1);
    if (!ready) {
      handshake.push(line);
      try {
        if ((JSON.parse(line) as { method?: string }).method === "notifications/initialized")
          ready = true;
      } catch {
        /* keep buffering handshake */
      }
    }
    child?.stdin?.write(line);
    i = inbuf.indexOf("\n");
  }
});
process.stdin.on("end", () => child?.stdin?.end());

start(false);

watch(here, (_evt, fname) => {
  if (!fname?.endsWith(".ts") || fname === "dev-stdio.ts") return;
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    process.stderr.write(`remarkable-mcp reload ${fname}\n`);
    start(true);
  }, 150);
});
