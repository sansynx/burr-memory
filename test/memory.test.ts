import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureSignal, resolvePlaybook, runSearch, setMode } from "../src/shared/memory.js";
import { readUsage } from "../src/shared/ledger.js";
import { withTempDir } from "./helpers.js";

const previousHome = process.env.BURR_HOME;

afterEach(() => {
  if (previousHome === undefined) delete process.env.BURR_HOME;
  else process.env.BURR_HOME = previousHome;
});

function fromTilde(home: string, display: string): string {
  return join(home, ...display.replace(/^~\//, "").split("/"));
}

describe("memory writes", () => {
  it("redacts secrets so they never hit disk", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const jwt = [
          "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
          "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0",
          "doz" + "jgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        ].join(".");
        const result = await captureSignal(
          dir,
          {
            error: `TypeError: Cannot read properties of undefined (reading 'id') token=${jwt} email=ada@example.com path=/Users/alex/app`,
            command: "npm test",
            exitCode: 1,
            whyKeep: "API response no longer includes id",
          },
          { home },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const written = await readFile(fromTilde(home, result.path), "utf8");
        expect(written).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
        expect(written).not.toContain("ada@example.com");
        expect(written).not.toContain("/Users/alex");
        expect(written).toContain("[REDACTED]");
      });
    });
  });

  it("discards ephemeral junk and ledgers it without writing a memory file", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const result = await captureSignal(
          dir,
          {
            error: "Error: listen EADDRINUSE: address already in use :::3000",
            command: "npm run dev",
          },
          { home },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe("port-in-use");
        const events = await readUsage(dir);
        expect(events.some((event) => event.verb === "discard")).toBe(true);
        const project = await readdir(join(dir, ".burr", "memory", "signals")).catch(() => []);
        const shared = await readdir(join(home, ".burr", "memory", "signals")).catch(() => []);
        expect(project.filter((name) => name.endsWith(".md"))).toEqual([]);
        expect(shared.filter((name) => name.endsWith(".md"))).toEqual([]);
      });
    });
  });

  it("writes a playbook after a verified fix and ledgers resolve", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const result = await resolvePlaybook(
          dir,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            rootCause: "API dropped the id field",
            fix: "Read user.uuid instead",
            verification: "npm test — 12 passed, 0 failing",
          },
          { home },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const written = await readFile(fromTilde(home, result.path), "utf8");
        expect(written).toContain("## Root Cause");
        expect(written).toContain("API dropped the id field");
        const events = await readUsage(dir);
        expect(events.some((event) => event.verb === "resolve")).toBe(true);
      });
    });
  });

  it("search ledgers search then hit or miss", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        await resolvePlaybook(
          dir,
          {
            error: "Hydration mismatch on the settings date",
            rootCause: "timezone drift",
            fix: "UTC formatting",
            verification: "reproduced the mismatch, then it was gone",
          },
          { home },
        );
        const hit = await runSearch(dir, "hydration mismatch timezone", { home });
        expect(hit.hits.length).toBeGreaterThan(0);
        const miss = await runSearch(dir, "quantum foam buffer overflow xyzzy", { home });
        expect(miss.hits).toEqual([]);
        const verbs = (await readUsage(dir)).map((event) => event.verb);
        expect(verbs).toContain("search");
        expect(verbs).toContain("hit");
        expect(verbs).toContain("miss");
      });
    });
  });

  it("setMode writes on, strict, or off", async () => {
    await withTempDir(async (dir) => {
      await setMode(dir, "strict");
      const raw = await readFile(join(dir, ".burr", "config.json"), "utf8");
      expect(JSON.parse(raw).mode).toBe("strict");
    });
  });
});
