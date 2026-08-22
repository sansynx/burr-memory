import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchMemoryFiles } from "../../src/shared/search.js";
import { withTempDir } from "../helpers.js";

describe("search edges", () => {
  it("returns no hits for an empty query", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".burr", "memory", "playbooks"), { recursive: true });
      await writeFile(join(dir, ".burr", "memory", "playbooks", "one.md"), "# Hydration\n");
      expect(await searchMemoryFiles(dir, "   ")).toEqual([]);
    });
  });

  it("ignores non-markdown files in memory folders", async () => {
    await withTempDir(async (dir) => {
      const playbooks = join(dir, ".burr", "memory", "playbooks");
      await mkdir(playbooks, { recursive: true });
      await writeFile(join(playbooks, "notes.txt"), "hydration mismatch timezone UTC");
      expect(await searchMemoryFiles(dir, "hydration mismatch")).toEqual([]);
    });
  });

  it("does not throw when memory folders are missing", async () => {
    await withTempDir(async (dir) => {
      await expect(searchMemoryFiles(dir, "anything at all")).resolves.toEqual([]);
    });
  });

  it("caps results at five even when more files match", async () => {
    await withTempDir(async (dir) => {
      const playbooks = join(dir, ".burr", "memory", "playbooks");
      await mkdir(playbooks, { recursive: true });
      for (let i = 0; i < 8; i += 1) {
        await writeFile(join(playbooks, `hydration-${i}.md`), "# Hydration mismatch timezone UTC\n");
      }
      const hits = await searchMemoryFiles(dir, "hydration mismatch timezone");
      expect(hits.length).toBe(5);
    });
  });
});
