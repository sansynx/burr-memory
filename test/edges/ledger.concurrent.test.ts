import { mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendUsage, readUsage } from "../../src/shared/ledger.js";
import { withTempDir } from "../helpers.js";

describe("ledger concurrency", () => {
  it("repairs corruption without losing concurrent events", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, ".burr", "usage.jsonl");
      await mkdir(join(dir, ".burr"), { recursive: true });
      await writeFile(file, "not-json\n");

      await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          appendUsage(dir, {
            verb: "search",
            signature: `query-${index}`,
          }),
        ),
      );

      const raw = await readFile(file, "utf8");
      const events = await readUsage(dir);
      expect(raw).not.toContain("not-json");
      expect(events).toHaveLength(20);
      expect(new Set(events.map((event) => event.signature))).toHaveLength(20);
    });
  });

  it("replaces an abandoned ledger lock", async () => {
    await withTempDir(async (dir) => {
      const lock = join(dir, ".burr", "usage.jsonl.lock");
      await mkdir(join(dir, ".burr"), { recursive: true });
      await writeFile(lock, "abandoned\n");
      await utimes(lock, new Date(0), new Date(0));

      await appendUsage(dir, { verb: "search", signature: "after-stale-lock" });

      expect(await readUsage(dir)).toMatchObject([{ verb: "search", signature: "after-stale-lock" }]);
    });
  });
});
