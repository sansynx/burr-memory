import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { setMode } from "../../src/shared/memory.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { SKILL_NAMES, withTempDir } from "../helpers.js";

async function loadPlugin() {
  const root = findPackageRoot();
  return import(pathToFileURL(join(root, ".opencode", "plugins", "burr.mjs")).href);
}

describe("OpenCode", () => {
  it("writes the local plugin and six slash command files", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const plugin = await readFile(join(dir, ".opencode", "plugins", "burr.mjs"), "utf8");
      expect(plugin).toContain("experimental.chat.system.transform");
      for (const name of SKILL_NAMES) {
        const command = await readFile(join(dir, ".opencode", "command", `${name}.md`), "utf8");
        expect(command).toContain(`name: ${name}`);
      }
    });
  });

  it("merges the plugin path without wiping other opencode.json keys", async () => {
    await withTempDir(async (dir) => {
      await writeFile(
        join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json", model: "held", plugin: ["./keep.mjs"] }),
      );
      await runInit(dir);
      const merged = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
      expect(merged.$schema).toBe("https://opencode.ai/config.json");
      expect(merged.model).toBe("held");
      expect(merged.plugin).toEqual(["./keep.mjs", "./.opencode/plugins/burr.mjs"]);
    });
  });

  it("registers the six commands from SKILL.md files", async () => {
    const mod = await loadPlugin();
    const hooks = await mod.default({ directory: findPackageRoot(), worktree: findPackageRoot() });
    expect(Object.keys(hooks.command)).toEqual([...SKILL_NAMES]);
    expect(hooks.command["burr-search"].template).toContain("Search `.burr/memory");
  });

  it("injects the always-on rule when mode is on", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      await setMode(dir, "on");
      const mod = await loadPlugin();
      const hooks = await mod.default({ directory: dir, worktree: dir });
      const output = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]({}, output);
      expect(output.system.join("\n")).toContain("Burr is local debugging memory");
    });
  });

  it("stays silent when mode is off", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      await setMode(dir, "off");
      const mod = await loadPlugin();
      const hooks = await mod.default({ directory: dir, worktree: dir });
      const output = { system: [] as string[] };
      await hooks["experimental.chat.system.transform"]({}, output);
      expect(output.system).toEqual([]);
    });
  });
});
