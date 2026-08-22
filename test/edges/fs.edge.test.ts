import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertInside, resolveProjectRoot, writeInside, writeIfMissing } from "../../src/shared/fs.js";
import { withTempDir } from "../helpers.js";

describe("safe fs edges", () => {
  it("refuses .. traversal and absolute paths", async () => {
    await withTempDir(async (dir) => {
      const root = await resolveProjectRoot(dir);
      expect(() => assertInside(root, join(root, "sub", "..", "..", "escape.md"))).toThrow(/outside/i);
      expect(() => assertInside(root, join(root, "..", "escape.md"))).toThrow(/outside/i);
    });
  });

  it("writeInside cannot land a file outside the project", async () => {
    await withTempDir(async (dir) => {
      await expect(writeInside(dir, "../outside.md", "nope")).rejects.toThrow(/outside/i);
    });
  });

  it("write-if-missing is atomic against an existing empty file", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "empty.md");
      await writeFile(file, "");
      expect(await writeIfMissing(dir, file, "fresh")).toBe("skipped");
      expect(await (await import("node:fs/promises")).readFile(file, "utf8")).toBe("");
    });
  });

  it("refuses writes through a symlink inside an approved root", async () => {
    await withTempDir(async (dir) => {
      const root = join(dir, "root");
      const outside = join(dir, "outside");
      const link = join(root, "linked");
      await mkdir(root);
      await mkdir(outside);
      try {
        await symlink(outside, link, "dir");
      } catch {
        return;
      }

      await expect(writeInside(root, "linked/escape.md", "nope")).rejects.toThrow(
        /symlink/i,
      );
      await expect(readFile(join(outside, "escape.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });
});
