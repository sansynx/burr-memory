import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureSignal, resolvePlaybook, runSearch, setMode } from "../../src/shared/memory.js";
import { readUsage } from "../../src/shared/ledger.js";
import { signature } from "../../src/shared/playbook.js";
import { withTempDir } from "../helpers.js";

const previousHome = process.env.BURR_HOME;

afterEach(() => {
  if (previousHome === undefined) delete process.env.BURR_HOME;
  else process.env.BURR_HOME = previousHome;
});

function fromTilde(home: string, display: string): string {
  return join(home, ...display.replace(/^~\//, "").split("/"));
}

describe("memory edges", () => {
  it("discards a blank error instead of writing a signal", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const result = await captureSignal(dir, { error: "   " }, { home });
        expect(result).toEqual({ ok: false, reason: "empty-error" });
        const files = await readdir(join(home, ".burr", "memory", "signals")).catch(() => []);
        expect(files.filter((name) => name.endsWith(".md"))).toEqual([]);
        expect((await readUsage(dir)).some((event) => event.reason === "empty-error")).toBe(true);
      });
    });
  });

  it("never uses path separators in a signature", () => {
    const slug = signature("failed at ../../../etc/passwd and C:\\\\Users\\\\alex\\\\secret.env");
    expect(slug).not.toContain("/");
    expect(slug).not.toContain("\\");
    expect(slug).not.toContain("..");
  });

  it("clips attempted fixes to 20 entries before write", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const result = await captureSignal(
          dir,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            attemptedFixes: Array.from({ length: 40 }, (_, i) => `try ${i}`),
            whyKeep: "API shape change",
          },
          { home },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const written = await readFile(fromTilde(home, result.path), "utf8");
        expect(written).toContain("try 0");
        expect(written).toContain("try 19");
        expect(written).not.toContain("try 20");
      });
    });
  });

  it("setMode writes only the mode field", async () => {
    await withTempDir(async (dir) => {
      await setMode(dir, "off");
      const config = JSON.parse(await readFile(join(dir, ".burr", "config.json"), "utf8"));
      expect(Object.keys(config)).toEqual(["mode"]);
      expect(config.mode).toBe("off");
    });
  });

  it("setMode preserves future config fields", async () => {
    await withTempDir(async (dir) => {
      await setMode(dir, "on");
      await writeFile(
        join(dir, ".burr", "config.json"),
        `${JSON.stringify({ mode: "on", futureOption: true }, null, 2)}\n`,
      );

      await setMode(dir, "strict");

      const config = JSON.parse(await readFile(join(dir, ".burr", "config.json"), "utf8"));
      expect(config).toEqual({ mode: "strict", futureOption: true });
    });
  });

  it("search on an empty store ledgers a miss and does not throw", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const { hits } = await runSearch(dir, "nothing here", { home });
        expect(hits).toEqual([]);
        expect((await readUsage(dir)).map((event) => event.verb)).toEqual(["search", "miss"]);
      });
    });
  });

  it("resolve refuses a playbook when verification is missing", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const result = await resolvePlaybook(
          dir,
          {
            error: "TypeError: boom",
            rootCause: "null",
            fix: "guard",
            verification: "fixed",
          },
          { home },
        );
        expect(result.ok).toBe(false);
      });
    });
  });
});
