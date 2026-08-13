import { describe, expect, it } from "vitest";
import { createApi } from "../src/api.js";
import { EXECUTOR_KIND, NodeVmExecutor } from "../src/executor.js";
import { MemoryFs } from "../src/fs.js";

describe("code-mode executor", () => {
  it("runs model JS against the live API and cannot touch host fs or net", async () => {
    expect(EXECUTOR_KIND).toBe("node:vm");
    const fs = new MemoryFs();
    const api = createApi(fs);
    const executor = new NodeVmExecutor();
    const result = await executor.execute(
      `async () => {
        const before = await rme.list({});
        await rme.mkdir({ name: "Projects" });
        const after = await rme.list({});
        return { beforeNames: before.map(i => i.name), afterNames: after.map(i => i.name) };
      }`,
      [
        {
          name: "rme",
          fns: {
            list: (args) => api.list((args ?? {}) as { includeTrash?: boolean; folder?: string }),
            mkdir: (args) => api.mkdir(args as { name: string; parent?: string }),
          },
        },
      ],
    );
    expect(result.error).toBeUndefined();
    const value = result.result as { beforeNames: string[]; afterNames: string[] };
    expect(value.beforeNames).not.toContain("Projects");
    expect(value.afterNames).toContain("Projects");

    const blocked = await executor.execute(`async () => { return typeof process + typeof require + typeof fetch; }`, []);
    expect(blocked.error).toBeUndefined();
    expect(blocked.result).toBe("undefinedundefinedundefined");
  });
});
