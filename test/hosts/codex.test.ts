import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { SKILL_NAMES, withTempDir } from "../helpers.js";

describe("Codex", () => {
  it("exposes skills under .agents/skills for @burr* invocation", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      for (const name of SKILL_NAMES) {
        const skill = await readFile(join(dir, ".agents", "skills", name, "SKILL.md"), "utf8");
        expect(skill).toContain(`name: ${name}`);
      }
    });
  });

  it("points the package Codex plugin at the shared skills tree", async () => {
    const root = findPackageRoot();
    const manifest = JSON.parse(
      await readFile(join(root, ".codex-plugin", "plugin.json"), "utf8"),
    );
    expect(manifest.name).toBe("burr");
    expect(manifest.skills).toBe("./skills/");
  });

  it("never writes AGENTS.md, even when the project has none", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      await expect(readFile(join(dir, "AGENTS.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("leaves an existing AGENTS.md untouched", async () => {
    await withTempDir(async (dir) => {
      await (await import("node:fs/promises")).writeFile(join(dir, "AGENTS.md"), "codex house rules\n");
      await runInit(dir);
      expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("codex house rules\n");
    });
  });

  it("help text tells Codex users to @ the skill names", async () => {
    const root = findPackageRoot();
    const help = await readFile(join(root, "skills", "burr-help", "SKILL.md"), "utf8");
    expect(help).toContain("@burr-search");
  });
});
