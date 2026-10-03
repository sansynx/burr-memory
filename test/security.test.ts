import {
  link,
  mkdir,
  readFile,
  readdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  promotePlaybook,
  captureSignal,
  resolvePlaybook,
} from "../src/shared/memory.js";
import { mergeOpenCodePlugin } from "../src/shared/opencode.js";
import { writeInside } from "../src/shared/fs.js";
import { searchMemoryFiles } from "../src/shared/search.js";
import { SHORT_LIMIT } from "../src/shared/bounds.js";
import { ensureUserMemory } from "../src/shared/user-memory.js";
import { loadConfig, saveConfig } from "../src/shared/config.js";
import { ensureStore } from "../src/shared/ensure-store.js";
import { withTempDir } from "./helpers.js";

function syntheticJwt(): string {
  return [
    "eyJ" + "hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0",
    "doz" + "jgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  ].join(".");
}

describe("security boundaries", () => {
  it("initializes one project concurrently without losing its ignore rules", async () => {
    await withTempDir(async (root) => {
      await writeFile(join(root, ".gitignore"), "user-owned\n");
      await Promise.all(Array.from({ length: 10 }, () => ensureStore(root)));
      expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(
        "user-owned\n.burr/\n",
      );
    });
  });
  it("redacts complete private keys before clipping input fields", async () => {
    await withTempDir(async (home) => {
      const marker = ["SYNTHETIC", "PRIVATE", "MATERIAL"].join("_");
      const key = [
        "-----BEGIN " + "PRIVATE KEY-----",
        marker.repeat(1000),
        "-----END " + "PRIVATE KEY-----",
      ].join("\n");
      const result = await captureSignal(
        home,
        {
          error: `TypeError: ${key}`,
          command: key,
          attemptedFixes: [key],
          whyKeep: "response schema changed",
        },
        { home },
      );
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(
          await readFile(join(home, result.path.replace(/^~\//, "")), "utf8"),
        ).not.toContain(marker);
    });
  });

  it("refuses memory directory junctions before creating anything outside home", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (outside) => {
        await symlink(outside, join(home, ".burr"), "junction");
        await expect(ensureUserMemory(home)).rejects.toThrow(/symlink/i);
        expect(await readdir(outside)).toEqual([]);
      });
    });
  });

  it("preserves unknown nested configuration when changing mode", async () => {
    await withTempDir(async (root) => {
      await mkdir(join(root, ".burr"));
      const file = join(root, ".burr", "config.json");
      await writeFile(
        file,
        JSON.stringify({
          runtime: { custom: "keep" },
          memory: { custom: "keep" },
        }),
      );
      await saveConfig(root, { mode: "off" });
      expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({
        runtime: { custom: "keep" },
        memory: { custom: "keep" },
      });
      expect((await loadConfig(root)).mode).toBe("off");
    });
  });
  it("redacts and bounds every field persisted to shared memory", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const secret = syntheticJwt();
        const signal = await captureSignal(
          dir,
          {
            error: "TypeError: missing id",
            exitCode: `token=${secret}`,
            whyKeep: "response schema changed",
          },
          { home },
        );
        expect(signal.ok).toBe(true);
        if (!signal.ok) return;

        const resolved = await resolvePlaybook(
          dir,
          {
            error: "TypeError: missing id",
            rootCause: "response schema changed",
            fix: "validate the response",
            verification: "npm test passed",
            context: {
              language: `token=${secret}`,
              framework: "x".repeat(SHORT_LIMIT + 1),
            },
          },
          { home },
        );
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;

        const signalMarkdown = await readFile(
          join(home, signal.path.replace(/^~\//, "")),
          "utf8",
        );
        const playbookMarkdown = await readFile(
          join(home, resolved.path.replace(/^~\//, "")),
          "utf8",
        );
        expect(`${signalMarkdown}\n${playbookMarkdown}`).not.toContain(secret);
        expect(playbookMarkdown).not.toContain("x".repeat(SHORT_LIMIT + 1));
      });
    });
  });

  it("refuses symlinked legacy playbooks during search and promotion", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (outside) => {
        await withTempDir(async (dir) => {
          const playbooks = join(dir, ".burr", "memory", "playbooks");
          const target = join(outside, "private.md");
          await mkdir(playbooks, { recursive: true });
          await writeFile(
            target,
            "---\nkind: playbook\n---\n# private deployment credential\n",
          );
          try {
            await symlink(target, join(playbooks, "legacy.md"), "file");
          } catch {
            return;
          }

          expect(
            await searchMemoryFiles(dir, "private deployment credential"),
          ).toEqual([]);
          expect(
            await promotePlaybook(dir, {
              path: ".burr/memory/playbooks/legacy.md",
              home,
            }),
          ).toEqual({ ok: false, reason: "not-a-playbook" });
          expect(
            await readdir(join(home, ".burr", "memory", "playbooks")).catch(
              () => [],
            ),
          ).toEqual([]);
        });
      });
    });
  });

  it("preserves a non-object OpenCode configuration without throwing", async () => {
    await withTempDir(async (dir) => {
      await writeFile(join(dir, "opencode.json"), "null");
      await expect(
        mergeOpenCodePlugin(
          dir,
          "opencode.json",
          "./.opencode/plugins/burr.mjs",
        ),
      ).resolves.toBe("skipped");
      expect(await readFile(join(dir, "opencode.json"), "utf8")).toBe("null");
    });
  });

  it("refuses hard-linked files before they can be overwritten", async () => {
    await withTempDir(async (dir) => {
      const outside = join(dir, "outside.txt");
      const linked = join(dir, "linked.txt");
      await writeFile(outside, "preserve this");
      await link(outside, linked);

      await expect(writeInside(dir, linked, "overwrite")).rejects.toThrow(
        /hard link/i,
      );
      expect(await readFile(outside, "utf8")).toBe("preserve this");
    });
  });
});
