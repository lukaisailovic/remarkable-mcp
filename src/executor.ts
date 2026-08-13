import { createContext, runInContext } from "node:vm";

/** Local Code Mode sandbox. Isolated-vm is skipped (native addon); node:vm is the executor that actually runs. */
export const EXECUTOR_KIND = "node:vm" as const;

export type ExecuteResult = { result: unknown; error?: string; logs?: string[] };
export type ResolvedProvider = {
  name: string;
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>;
};
export type Executor = {
  execute(
    code: string,
    providersOrFns: ResolvedProvider[] | Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult>;
};

const INJECT = {
  Promise,
  Array,
  Object,
  JSON,
  Math,
  Date,
  Map,
  Set,
  WeakMap,
  WeakSet,
  Number,
  String,
  Boolean,
  Error,
  TypeError,
  RangeError,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
  undefined,
  NaN,
  Infinity,
  encodeURIComponent,
  decodeURIComponent,
  encodeURI,
  decodeURI,
  Uint8Array,
  ArrayBuffer,
  TextEncoder,
  TextDecoder,
};

/** Same contract as `@cloudflare/codemode` `normalizeCode` — main entry can't load in Node (`cloudflare:workers`). */
export function normalizeCode(code: string): string {
  const fenced = code
    .trim()
    .match(/^```(?:js|javascript|typescript|ts|tsx|jsx)?\s*\n([\s\S]*?)```\s*$/);
  const source = (fenced?.[1] ?? code).trim();
  if (!source) return "async () => {}";
  if (/^(async\s*)?\([^)]*\)\s*=>/.test(source)) return source;
  return `async () => {\n${source}\n}`;
}

export class NodeVmExecutor implements Executor {
  readonly kind = EXECUTOR_KIND;

  async execute(
    code: string,
    providersOrFns: ResolvedProvider[] | Record<string, (...args: unknown[]) => Promise<unknown>>,
  ): Promise<ExecuteResult> {
    const providers: ResolvedProvider[] = Array.isArray(providersOrFns)
      ? providersOrFns
      : [{ name: "rme", fns: providersOrFns }];
    const logs: string[] = [];
    const sandbox: Record<string, unknown> = {
      ...INJECT,
      console: {
        log: (...a: unknown[]) => logs.push(a.map(fmt).join(" ")),
        info: (...a: unknown[]) => logs.push(a.map(fmt).join(" ")),
        warn: (...a: unknown[]) => logs.push(a.map(fmt).join(" ")),
        error: (...a: unknown[]) => logs.push(a.map(fmt).join(" ")),
      },
    };
    for (const p of providers) {
      sandbox[p.name] = Object.fromEntries(
        Object.entries(p.fns).map(([k, fn]) => [k, (...args: unknown[]) => fn(...args)]),
      );
    }
    const context = createContext(sandbox, {
      name: "remarkable-codemode",
      codeGeneration: { strings: false, wasm: false },
    });
    try {
      const src = normalizeCode(code);
      const fn = runInContext(`(${src})`, context, { timeout: 15_000, filename: "codemode.js" });
      if (typeof fn !== "function")
        return { result: undefined, error: "normalized code is not a function", logs };
      const result = await (fn as () => unknown)();
      return { result, logs };
    } catch (e) {
      return { result: undefined, error: e instanceof Error ? e.message : String(e), logs };
    }
  }
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
