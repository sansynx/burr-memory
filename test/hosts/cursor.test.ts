import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { withTempDir } from "../helpers.js";

describe("Cursor", () => {
  it("writes an always-on rule file, not slash-command skills", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const rule = await readFile(join(dir, ".cursor", "rules", "burr.mdc"), "utf8");
      expect(rule).toMatch(/^---\r?\n/);
      expect(rule).toContain("alwaysApply: true");
      expect(rule).toContain("Burr is local debugging memory");
      await expect(readdir(join(dir, ".cursor", "skills"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("does not overwrite a user-edited Cursor rule", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const file = join(dir, ".cursor", "rules", "burr.mdc");
      await writeFile(file, "# my cursor rule\n");
      await runInit(dir);
      expect(await readFile(file, "utf8")).toBe("# my cursor rule\n");
    });
  });

  it("does not edit a pre-existing foreign Cursor rule", async () => {
    await withTempDir(async (dir) => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
      await writeFile(join(dir, ".cursor", "rules", "team.mdc"), "team only");
      await runInit(dir);
      expect(await readFile(join(dir, ".cursor", "rules", "team.mdc"), "utf8")).toBe("team only");
    });
  });
});
