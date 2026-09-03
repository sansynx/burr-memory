import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clip } from "../src/shared/bounds.js";
import { tokenize } from "../src/shared/tokens.js";
import { redactUnbounded } from "../src/shared/redaction.js";
import { mergeOpenCodePlugin } from "../src/shared/opencode.js";
import { setMode, status } from "../src/shared/memory.js";
import { searchMemoryFiles } from "../src/shared/search.js";
import { appendUsage, readUsage, summarizeUsage } from "../src/shared/ledger.js";
import { findPackageRoot } from "../src/shared/package-root.js";
import { withTempDir } from "./helpers.js";

describe("audit: performance, dead code, and security improvements", () => {
  describe("bounds and tokenization micro-optimizations", () => {
    it("handles empty or falsy strings safely in clip", () => {
      expect(clip("")).toBe("");
      expect(clip(null as unknown as string)).toBe("");
      expect(clip(undefined as unknown as string)).toBe("");
      expect(clip("hello", 3)).toBe("hel");
    });

    it("returns empty array immediately for empty or falsy strings in tokenize", () => {
      expect(tokenize("")).toEqual([]);
      expect(tokenize("   ")).toEqual([]);
      expect(tokenize("the a an and or")).toEqual([]);
      expect(tokenize("Error: Failed to connect")).toEqual(["error", "failed", "connect"]);
    });

    it("returns empty string immediately for empty string in redactUnbounded", () => {
      expect(redactUnbounded("")).toBe("");
    });
  });

  describe("searchMemoryFiles optimizations", () => {
    it("returns empty array immediately when query has no searchable tokens", async () => {
      await withTempDir(async (dir) => {
        const hits = await searchMemoryFiles(dir, "the a an on");
        expect(hits).toEqual([]);
      });
    });
  });

  describe("security: path containment and prototype pollution prevention", () => {
    it("rejects traversal attempts in mergeOpenCodePlugin", async () => {
      await withTempDir(async (dir) => {
        const result = await mergeOpenCodePlugin(dir, "../escaped.json", "./plugin.mjs");
        expect(result).toBe("skipped");
      });
    });

    it("strips prototype pollution keys when persisting mode in setMode", async () => {
      await withTempDir(async (dir) => {
        const configPath = join(dir, ".burr", "config.json");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(dir, ".burr"), { recursive: true });
        await writeFile(
          configPath,
          JSON.stringify({
            __proto__: { polluted: true },
            mode: "on",
            validField: 123,
          }),
        );

        await setMode(dir, "strict");

        const raw = await readFile(configPath, "utf8");
        expect(raw).not.toContain("__proto__");
        const parsed = JSON.parse(raw);
        expect(parsed.mode).toBe("strict");
        expect(parsed.validField).toBe(123);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      });
    });
  });

  describe("status and ledger efficiency", () => {
    it("correctly aggregates mode and counts in parallel status call", async () => {
      await withTempDir(async (dir) => {
        await setMode(dir, "on");
        await appendUsage(dir, { verb: "hit", path: "playbook.md" });
        const res = await status(dir);
        expect(res.mode).toBe("on");
        expect(typeof res.playbooks).toBe("number");
        expect(typeof res.signals).toBe("number");
        expect(res.lastHit?.path).toBe("playbook.md");
      });
    });

    it("cleans corrupt lines in a single pass without data loss", async () => {
      await withTempDir(async (dir) => {
        const file = join(dir, ".burr", "usage.jsonl");
        const { mkdir } = await import("node:fs/promises");
        await mkdir(join(dir, ".burr"), { recursive: true });
        await writeFile(
          file,
          "invalid json line\n{\"ts\":\"2026-01-01T00:00:00.000Z\",\"verb\":\"search\"}\n",
        );

        const events = await readUsage(dir);
        expect(events).toHaveLength(1);
        expect(events[0]?.verb).toBe("search");

        await appendUsage(dir, { verb: "hit", path: "test.md" });
        const summary = await summarizeUsage(dir);
        expect(summary.counts.search).toBe(1);
        expect(summary.counts.hit).toBe(1);
        expect(summary.lastHits[0]?.path).toBe("test.md");
      });
    });

    it("caches findPackageRoot across multiple invocations", () => {
      const root1 = findPackageRoot();
      const root2 = findPackageRoot();
      expect(root1).toBe(root2);
    });
  });
});
