import { link, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "../helpers.js";

const race = vi.hoisted(() => ({ target: "", eperm: "" }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      const target = resolve(String(args[0]));
      if (race.eperm && target === race.eperm) {
        race.eperm = `armed:${target}`;
      }
      if (race.target && target === race.target) {
        race.target = "";
        try {
          await actual.unlink(target);
          await actual.writeFile(target, "decoy");
        } catch {
          // Windows can keep the name in a pending-delete state while the handle is open.
        }
      }
      return handle;
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      const target = resolve(String(args[0]));
      if (race.eperm === `armed:${target}`) {
        race.eperm = "";
        const error = new Error(`EPERM: operation not permitted, lstat '${target}'`) as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return actual.lstat(...args);
    },
  };
});

import { writeInside } from "../../src/shared/fs.js";

describe("safe fs path races", () => {
  it("treats a post-open lstat EPERM as a changed path", async () => {
    await withTempDir(async (dir) => {
      const target = join(dir, "locked.txt");
      await writeFile(target, "original");
      race.eperm = resolve(target);

      await expect(writeInside(dir, target, "overwrite")).rejects.toThrow(/changed path/i);
      expect(await readFile(target, "utf8")).toBe("original");
    });
  });

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
