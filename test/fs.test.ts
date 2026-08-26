import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertInside, resolveProjectRoot, writeIfMissing } from "../src/shared/fs.js";
import { withTempDir } from "./helpers.js";

describe("safe fs", () => {
  it("refuses writes that escape the project root", async () => {
    await withTempDir(async (dir) => {
      const root = await resolveProjectRoot(dir);
      expect(() => assertInside(root, join(root, "..", "outside.md"))).toThrow(/outside/i);
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
        await symlink(real, link, process.platform === "win32" ? "junction" : "dir");
      } catch {
        return;
      }
      await expect(resolveProjectRoot(link)).rejects.toThrow(/symlink/i);
    });
  });
});
