import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendUsage, readUsage, summarizeUsage } from "../src/shared/ledger.js";
import { withTempDir } from "./helpers.js";

describe("ledger", () => {
  it("appends one JSON line per event", async () => {
    await withTempDir(async (dir) => {
      await appendUsage(dir, { verb: "search", signature: "typeerror-x" });
      await appendUsage(dir, { verb: "hit", path: ".burr/memory/playbooks/typeerror-x.md" });
      const raw = await readFile(join(dir, ".burr", "usage.jsonl"), "utf8");
      const lines = raw.trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]!).verb).toBe("search");
      expect(JSON.parse(lines[1]!).verb).toBe("hit");
    });
  });

  it("rewrites only when the file is corrupt", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, ".burr", "usage.jsonl");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(join(dir, ".burr"), { recursive: true });
      await writeFile(file, "not-json\n{\"ts\":\"2026-08-22T04:30:00.000Z\",\"verb\":\"miss\"}\n");
      const events = await readUsage(dir);
      expect(events).toHaveLength(1);
      expect(events[0]?.verb).toBe("miss");
      await appendUsage(dir, { verb: "search" });
      const raw = await readFile(file, "utf8");
      expect(raw).not.toContain("not-json");
      expect(raw.trim().split("\n")).toHaveLength(2);
    });
  });

  it("summarizes verbs, last hits, and last discards", async () => {
    await withTempDir(async (dir) => {
      await appendUsage(dir, { verb: "search" });
      await appendUsage(dir, { verb: "hit", path: "a.md" });
      await appendUsage(dir, { verb: "discard", reason: "port-in-use" });
      const summary = await summarizeUsage(dir);
      expect(summary.counts.search).toBe(1);
      expect(summary.counts.hit).toBe(1);
      expect(summary.counts.discard).toBe(1);
      expect(summary.lastHits[0]?.path).toBe("a.md");
      expect(summary.lastDiscards[0]?.reason).toBe("port-in-use");
    });
  });
});
