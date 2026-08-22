import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { withTempDir } from "../helpers.js";

describe("init edges", () => {
  it("leaves a corrupt opencode.json untouched", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "opencode.json");
      await writeFile(file, "{not-json");
      await runInit(dir);
      expect(await readFile(file, "utf8")).toBe("{not-json");
    });
  });

  it("only reports relative project paths, never a home-agent path", async () => {
    await withTempDir(async (dir) => {
      const result = await runInit(dir);
      const home = homedir().replaceAll("\\", "/").toLowerCase();
      for (const path of [...result.created, ...result.skipped]) {
        expect(path.startsWith(".") || path === "opencode.json").toBe(true);
        expect(path.replaceAll("\\", "/").toLowerCase()).not.toContain(home);
        expect(path).not.toMatch(/^~[\\/]/);
      }
    });
  });

  it("does not put keys or URLs into config.json", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const config = JSON.parse(await readFile(join(dir, ".burr", "config.json"), "utf8"));
      expect(config).toEqual({ mode: "on" });
    });
  });

  it("prints that no existing instruction file was modified on a no-op second run", async () => {
    await withTempDir(async (dir) => {
      await runInit(dir);
      const logs: string[] = [];
      await runInit(dir, { log: (line) => logs.push(line) });
      expect(logs.join("\n")).toMatch(/no existing instruction file was modified/i);
    });
  });
});
