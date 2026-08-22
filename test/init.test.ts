import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../src/cli/init.js";
import { withTempDir } from "./helpers.js";

const SKILLS = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-promote",
  "burr-audit",
  "burr-help",
];

describe("burr init", () => {
  it("creates the local store and host own-files", async () => {
    await withTempDir(async (dir) => {
      const result = await runInit(dir);
      expect(result.created.length).toBeGreaterThan(0);
      expect(result.untouchedInstructions).toBe(true);

      const config = JSON.parse(await readFile(join(dir, ".burr", "config.json"), "utf8"));
      expect(config).toEqual({ mode: "on" });
      expect(config).not.toHaveProperty("key");
      expect(config).not.toHaveProperty("url");

      const instructions = await readFile(join(dir, ".burr", "instructions.md"), "utf8");
      expect(instructions).toContain("Burr is local debugging memory");

      await readFile(join(dir, ".burr", "usage.jsonl"), "utf8");
      await expect(readdir(join(dir, ".burr", "memory"))).rejects.toMatchObject({
        code: "ENOENT",
      });

      for (const name of SKILLS) {
        for (const tree of [".burr/skills", ".claude/skills", ".agents/skills", ".pi/skills"]) {
          const skill = await readFile(join(dir, tree, name, "SKILL.md"), "utf8");
          expect(skill).toContain(`name: ${name}`);
        }
      }

      const cursor = await readFile(join(dir, ".cursor", "rules", "burr.mdc"), "utf8");
      expect(cursor).toContain("alwaysApply: true");
      expect(cursor).toContain("Burr is local debugging memory");

      const windsurf = await readFile(join(dir, ".windsurf", "rules", "burr.md"), "utf8");
      expect(windsurf).toContain("Burr is local debugging memory");

      const plugin = await readFile(join(dir, ".opencode", "plugins", "burr.mjs"), "utf8");
      expect(plugin).toContain(".burr");

      const opencode = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
      expect(opencode.plugin).toContain("./.opencode/plugins/burr.mjs");

      const ignore = await readFile(join(dir, ".gitignore"), "utf8");
      expect(ignore.split(/\r?\n/).map((line) => line.trim())).toContain(".burr/");
    });
  });

  it("appends .burr/ to an existing gitignore without wiping other entries", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, ".gitignore"), "node_modules/\n");
      await runInit(dir);
      const ignore = await readFile(join(dir, ".gitignore"), "utf8");
      expect(ignore).toContain("node_modules/");
      expect(ignore).toMatch(/^\.burr\/$/m);
    });
  });

  it("does not overwrite user edits on a second run", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const skill = join(dir, ".burr", "skills", "burr", "SKILL.md");
      await writeFile(skill, "# user edit\n");
      const second = await runInit(dir);
      expect(second.created).toEqual([]);
      expect(await readFile(skill, "utf8")).toBe("# user edit\n");
    });
  });

  it("does not touch AGENTS.md or CLAUDE.md", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "AGENTS.md"), "stay");
      await writeFile(join(dir, "CLAUDE.md"), "stay");
      await runInit(dir);
      expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("stay");
      expect(await readFile(join(dir, "CLAUDE.md"), "utf8")).toBe("stay");
    });
  });

  it("merges the plugin path into an existing opencode.json", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ model: "x", plugin: ["./other.mjs"] }, null, 2),
      );
      await runInit(dir);
      const merged = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
      expect(merged.model).toBe("x");
      expect(merged.plugin).toEqual(["./other.mjs", "./.opencode/plugins/burr.mjs"]);
    });
  });

  it("prints created paths and the no-instruction-edit statement", async () => {
    await withTempDir(async (dir) => {
      const logs: string[] = [];
      const result = await runInit(dir, { log: (line) => logs.push(line) });
      expect(logs.some((line) => line.includes(".burr/config.json") || line.includes(".burr\\config.json"))).toBe(true);
      expect(logs.join("\n")).toMatch(/no existing instruction file was modified/i);
      expect(result.created.length).toBeGreaterThan(0);
    });
  });

  it("does not create a foreign rule file that already existed under another name", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".cursor", "rules"), { recursive: true });
      await writeFile(join(dir, ".cursor", "rules", "project.mdc"), "mine");
      await runInit(dir);
      expect(await readFile(join(dir, ".cursor", "rules", "project.mdc"), "utf8")).toBe("mine");
    });
  });
});
