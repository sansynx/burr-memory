import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { SKILL_NAMES, withTempDir } from "../helpers.js";

describe("Claude Code", () => {
  it("copies all seven project skills as /burr* commands", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      for (const name of SKILL_NAMES) {
        const skill = await readFile(join(dir, ".claude", "skills", name, "SKILL.md"), "utf8");
        expect(skill).toContain(`name: ${name}`);
        expect(skill).toContain("description:");
      }
    });
  });

  it("keeps the package plugin thin: only plugin.json under .claude-plugin", async () => {
    const root = findPackageRoot();
    const names = await readdir(join(root, ".claude-plugin"));
    expect(names).toEqual(["plugin.json"]);
    const manifest = JSON.parse(await readFile(join(root, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("burr");
    expect(manifest).not.toHaveProperty("skills");
  });

  it("does not write a project CLAUDE.md to enable Burr", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      await expect(readFile(join(dir, "CLAUDE.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("second init leaves an edited Claude skill alone", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const file = join(dir, ".claude", "skills", "burr-search", "SKILL.md");
      await (await import("node:fs/promises")).writeFile(file, "# edited claude skill\n");
      await runInit(dir);
      expect(await readFile(file, "utf8")).toBe("# edited claude skill\n");
    });
  }, 15000);
});
