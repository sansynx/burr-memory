import { mkdir, symlink, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertInside,
  resolveProjectRoot,
  writeIfMissing,
  withInsideLock,
} from "../src/shared/fs.js";
import { withTempDir } from "./helpers.js";

describe("safe fs", () => {
  it("recovers a stale lock even if the previous recovery process died", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "orphan.lock");
      for (const name of [file, `${file}.recovery`]) {
        await writeFile(name, "dead-owner\n");
        await utimes(name, 0, 0);
      }
      await expect(
        withInsideLock(dir, file, async () => "recovered"),
      ).resolves.toBe("recovered");
    });
  });
  it("serializes writers racing to recover one abandoned lock", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "abandoned.lock");
      await writeFile(file, "legacy-owner\n");
      await utimes(file, 0, 0);
      let active = 0;
      let maximum = 0;
      let completed = 0;
      await Promise.all(
        Array.from({ length: 10 }, () =>
          withInsideLock(dir, file, async () => {
            maximum = Math.max(maximum, ++active);
            await new Promise((resolve) => setTimeout(resolve, 10));
            active--;
            completed++;
          }),
        ),
      );
      expect(maximum).toBe(1);
      expect(completed).toBe(10);
    });
  });
  it("does not steal an old lock held by a live process", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "transaction.lock");
      let secondEntered = false;
      let second: Promise<void>;
      await withInsideLock(dir, file, async () => {
        await utimes(file, 0, 0);
        second = withInsideLock(dir, file, async () => {
          secondEntered = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(secondEntered).toBe(false);
      });
      await second!;
      expect(secondEntered).toBe(true);
    });
  });
  it("refuses writes that escape the project root", async () => {
    await withTempDir(async (dir) => {
      const root = await resolveProjectRoot(dir);
      expect(() => assertInside(root, join(root, "..", "outside.md"))).toThrow(
        /outside/i,
      );
    });
  });

  it("write-if-missing does not overwrite an edited file", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "keep.md");
      await writeFile(file, "user edit");
      const first = await writeIfMissing(dir, file, "fresh");
      expect(first).toBe("skipped");
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(file, "utf8")).toBe("user edit");
    });
  });

  it("creates a file when it is absent", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "new.md");
      const result = await writeIfMissing(dir, file, "hello");
      expect(result).toBe("created");
      const { readFile } = await import("node:fs/promises");
      expect(await readFile(file, "utf8")).toBe("hello");
    });
  });

  it("refuses a symlink project root when one can be created", async () => {
    await withTempDir(async (dir) => {
      const real = join(dir, "real");
      const link = join(dir, "link");
      await mkdir(real);
      try {
        await symlink(
          real,
          link,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch {
        return;
      }
      await expect(resolveProjectRoot(link)).rejects.toThrow(/symlink/i);
    });
  });
});
