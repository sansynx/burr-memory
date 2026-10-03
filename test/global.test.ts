import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runGlobal } from "../src/cli/global.js";
import { captureSignal } from "../src/shared/memory.js";
import { findPackageRoot } from "../src/shared/package-root.js";
import { SKILL_NAMES, withTempDir } from "./helpers.js";

const previousHome = process.env.BURR_HOME;

afterEach(() => {
  if (previousHome === undefined) delete process.env.BURR_HOME;
  else process.env.BURR_HOME = previousHome;
});

describe("burr global", () => {
  it("writes supported user-level integrations without creating memory eagerly", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      const result = await runGlobal();
      expect(
        result.created.some((path) => path.endsWith(".cursor/rules/burr.mdc")),
      ).toBe(false);
      expect(
        result.created.some((path) => path.endsWith(".windsurf/rules/burr.md")),
      ).toBe(false);

      for (const name of SKILL_NAMES) {
        const claude = await readFile(
          join(home, ".claude", "skills", name, "SKILL.md"),
          "utf8",
        );
        const agents = await readFile(
          join(home, ".agents", "skills", name, "SKILL.md"),
          "utf8",
        );
        const pi = await readFile(
          join(home, ".pi", "agent", "skills", name, "SKILL.md"),
          "utf8",
        );
        expect(claude).toContain(`name: ${name}`);
        expect(agents).toBe(claude);
        expect(pi).toBe(claude);
      }

      const plugin = await readFile(
        join(home, ".config", "opencode", "plugins", "burr.mjs"),
        "utf8",
      );
      expect(plugin).toContain("experimental.chat.system.transform");

      await expect(
        readFile(join(home, ".burr", "config.json"), "utf8"),
      ).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  it("does not overwrite an edited user Cursor rule", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await mkdir(join(home, ".cursor", "rules"), { recursive: true });
      await writeFile(join(home, ".cursor", "rules", "burr.mdc"), "# mine\n");
      const result = await runGlobal();
      expect(
        await readFile(join(home, ".cursor", "rules", "burr.mdc"), "utf8"),
      ).toBe("# mine\n");
      expect(
        result.skipped.some((path) => path.endsWith(".cursor/rules/burr.mdc")),
      ).toBe(false);
    });
  });

  it("is a no-op when the installed managed files are current", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await runGlobal();

      const second = await runGlobal();

      expect(second.created).toEqual([]);
    });
  });

  it("leaves formerly installed unsupported global rules untouched", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      const file = join(home, ".cursor", "rules", "burr.mdc");
      await mkdir(join(home, ".cursor", "rules"), { recursive: true });
      await writeFile(
        file,
        await readFile(
          join(findPackageRoot(), "test", "fixtures", "global-v1.mdc"),
          "utf8",
        ),
      );

      await runGlobal();

      expect(await readFile(file, "utf8")).toBe(
        await readFile(
          join(findPackageRoot(), "test", "fixtures", "global-v1.mdc"),
          "utf8",
        ),
      );
    });
  });

  it("preserves a user-edited legacy rule and warns instead of overwriting", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      const file = join(home, ".cursor", "rules", "burr.mdc");
      const edited =
        "# My edits\n\nNever keep a shared home memory dump.\nCustom project instructions.\n";
      await mkdir(join(home, ".cursor", "rules"), { recursive: true });
      await writeFile(file, edited);
      const logs: string[] = [];

      await runGlobal({ log: (line) => logs.push(line) });

      expect(await readFile(file, "utf8")).toBe(edited);
      expect(logs.join("\n")).toContain("Cursor and Windsurf");
    });
  });

  it("warns when an edited legacy audit skill cannot be upgraded safely", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      const file = join(home, ".agents", "skills", "burr-audit", "SKILL.md");
      const edited = "---\nname: burr-audit\n---\n# Custom audit\n";
      await mkdir(join(home, ".agents", "skills", "burr-audit"), {
        recursive: true,
      });
      await writeFile(file, edited);
      const logs: string[] = [];

      await runGlobal({ log: (line) => logs.push(line) });

      expect(await readFile(file, "utf8")).toBe(edited);
      expect(logs.join("\n")).toContain("~/.agents/skills/burr-audit/SKILL.md");
    });
  });

  it("installs a self-contained OpenCode plugin for projects without init", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await withTempDir(async (project) => {
        await runGlobal();
        const url = `${
          pathToFileURL(
            join(home, ".config", "opencode", "plugins", "burr.mjs"),
          ).href
        }?test=${Date.now()}`;
        const plugin = await import(url);
        const hooks = await plugin.default({
          directory: project,
          worktree: project,
        });
        const config = { command: {} };
        await hooks.config(config);
        expect(Object.keys(config.command)).toEqual([...SKILL_NAMES]);
        const output = { system: [] as string[] };
        await hooks["experimental.chat.system.transform"]({}, output);
        expect(output.system.join("\n")).toContain("~/.burr/memory/");
      });
    });
  });
});

describe("new project without init", () => {
  it("creates a project .burr store on first capture", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await withTempDir(async (dir) => {
        const result = await captureSignal(
          dir,
          {
            error:
              "TypeError: Cannot read properties of undefined (reading 'id')",
            whyKeep: "API dropped the id field",
          },
          { home },
        );
        expect(result.ok).toBe(true);
        const config = JSON.parse(
          await readFile(join(dir, ".burr", "config.json"), "utf8"),
        );
        expect(config.mode).toBe("on");
      });
    });
  });
});
