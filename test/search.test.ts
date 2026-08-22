import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchMemoryFiles } from "../src/shared/search.js";
import { withTempDir } from "./helpers.js";

describe("searchMemoryFiles", () => {
  it("ranks by filename, frontmatter, and token overlap", async () => {
    await withTempDir(async (dir) => {
      const playbooks = join(dir, ".burr", "memory", "playbooks");
      const signals = join(dir, ".burr", "memory", "signals");
      await mkdir(playbooks, { recursive: true });
      await mkdir(signals, { recursive: true });
      await writeFile(
        join(playbooks, "hydration-mismatch.md"),
        `---
title: Hydration mismatch
kind: playbook
---
# Hydration mismatch

## Root Cause

Server rendered UTC, client used local timezone.

## Fix

Format dates in UTC on both sides.
`,
      );
      await writeFile(
        join(signals, "unrelated-css.md"),
        `# Unrelated CSS specificity in a sidebar widget\n`,
      );

      const hits = await searchMemoryFiles(dir, "hydration mismatch timezone UTC");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.path.replaceAll("\\", "/")).toContain("hydration-mismatch.md");
      expect(hits[0]?.excerpt.toLowerCase()).toMatch(/utc|timezone|root cause/);
    });
  });

  it("returns an empty list on a miss", async () => {
    await withTempDir(async (dir) => {
      await mkdir(join(dir, ".burr", "memory", "playbooks"), { recursive: true });
      const hits = await searchMemoryFiles(dir, "quantum foam buffer overflow");
      expect(hits).toEqual([]);
    });
  });
});
