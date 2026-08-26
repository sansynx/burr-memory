import { link, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../helpers.js";

const race = vi.hoisted(() => ({ target: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const target = resolve(String(args[0]));
      if (race.target && target === race.target) {
        race.target = "";
        await actual.unlink(target);
        await actual.writeFile(target, "decoy");
      }
      return handle;
    },
  };
});

import { writeInside } from "../../src/shared/fs.js";

describe("safe fs path races", () => {
  it("refuses a path swapped after the destination handle opens", async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, "root");
      const outside = join(dir, "outside.txt");
      const target = join(root, "target.txt");
      await mkdir(root);
      await writeFile(outside, "preserve this");
      await link(outside, target);
      race.target = resolve(target);

      await expect(writeInside(root, target, "overwrite")).rejects.toThrow(/changed path/i);
      expect(await readFile(outside, "utf8")).toBe("preserve this");
    });
  });
});
