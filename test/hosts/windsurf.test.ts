import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { withTempDir } from "../helpers.js";

describe("Windsurf", () => {
  it("writes the always-on rule body without inventing slash commands", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const rule = await readFile(join(dir, ".windsurf", "rules", "burr.md"), "utf8");
      const instructions = await readFile(
        join(findPackageRoot(), "templates", "instructions.md"),
        "utf8",
      );
      expect(rule).toContain(instructions.trim());
      expect(rule).not.toContain("alwaysApply");
      await expect(readdir(join(dir, ".windsurf", "skills"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("does not overwrite a user-edited Windsurf rule", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const file = join(dir, ".windsurf", "rules", "burr.md");
      await writeFile(file, "# stay\n");
      await runInit(dir);
      expect(await readFile(file, "utf8")).toBe("# stay\n");
    });
  });
});
