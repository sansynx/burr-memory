import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../src/cli/index.js";
import { captureSignal, promotePlaybook, resolvePlaybook, runSearch } from "../src/shared/memory.js";
import { appendUsage, readUsage } from "../src/shared/ledger.js";
import { withTempDir } from "./helpers.js";

const previousHome = process.env.BURR_HOME;

afterEach(() => {
  if (previousHome === undefined) delete process.env.BURR_HOME;
  else process.env.BURR_HOME = previousHome;
});

async function verifiedPlaybook(dir: string, home: string) {
  return resolvePlaybook(
    dir,
    {
      error: "TypeError: Cannot read properties of undefined (reading 'id')",
      rootCause: "Prisma client was constructed in every Next.js route module",
      fix: "Export one PrismaClient singleton from lib/prisma",
      verification: "npm test — 12 passed, 0 failing",
    },
    { home },
  );
}

function fromTilde(home: string, display: string): string {
  return join(home, ...display.replace(/^~\//, "").split("/"));
}

describe("shared user memory", () => {
  it("resolve in one project is searchable from another without promote", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await withTempDir(async (shop) => {
        const resolved = await verifiedPlaybook(shop, home);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        expect(resolved.path.replaceAll("\\", "/")).toMatch(/^~\/\.burr\/memory\/playbooks\/.+\.md$/);
        expect(resolved.path).not.toMatch(/Users|Desktop/i);

        await withTempDir(async (other) => {
          const { hits } = await runSearch(other, "Prisma client singleton Next.js", { home });
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0]?.source).toBe("global");
          expect(hits[0]?.path.replaceAll("\\", "/")).toMatch(/^~\/\.burr\/memory\/playbooks\/.+\.md$/);
        });
      });
    });
  });

  it("capture in one project is searchable from another after compaction", async () => {
    await withTempDir(async (home) => {
      process.env.BURR_HOME = home;
      await withTempDir(async (first) => {
        const captured = await captureSignal(
          first,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            whyKeep: "API dropped the id field",
          },
          { home },
        );
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        expect(captured.path.replaceAll("\\", "/")).toMatch(/^~\/\.burr\/memory\/signals\/.+\.md$/);

        await withTempDir(async (later) => {
          const { hits } = await runSearch(later, "TypeError undefined reading id", { home });
          expect(hits.some((hit) => hit.source === "global")).toBe(true);
        });
      });
    });
  });

  it("resolve writes the playbook under the user store, not the project", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const resolved = await verifiedPlaybook(dir, home);
        expect(resolved.ok).toBe(true);
        if (!resolved.ok) return;
        const projectFiles = await readdir(join(dir, ".burr", "memory", "playbooks")).catch(() => []);
        expect(projectFiles.filter((name) => name.endsWith(".md"))).toEqual([]);
        const written = await readFile(fromTilde(home, resolved.path), "utf8");
        expect(written).toContain("PrismaClient singleton");
      });
    });
  });

  it("keeps distinct playbooks when the same error has different root causes", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (first) => {
        const prisma = await resolvePlaybook(
          first,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            rootCause: "Prisma result omitted the relation",
            fix: "Include the user relation in the query",
            verification: "npm test — 12 passed, 0 failing",
          },
          { home },
        );
        const api = await resolvePlaybook(
          first,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            rootCause: "The API renamed id to uuid",
            fix: "Read user.uuid",
            verification: "npm test — 12 passed, 0 failing",
          },
          { home },
        );

        expect(prisma.ok).toBe(true);
        expect(api.ok).toBe(true);
        if (!prisma.ok || !api.ok) return;
        expect(prisma.path).not.toBe(api.path);
        const files = await readdir(join(home, ".burr", "memory", "playbooks"));
        expect(files.filter((name) => name.endsWith(".md"))).toHaveLength(2);
      });
    });
  });

  it("promote still lifts a leftover project playbook into the user store", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const playbooks = join(dir, ".burr", "memory", "playbooks");
        await mkdir(playbooks, { recursive: true });
        await writeFile(
          join(playbooks, "old-local.md"),
          `---
title: Old local
kind: playbook
---
# Old local

email=ada@example.com path=/Users/alex/app
`,
        );
        const promoted = await promotePlaybook(dir, {
          path: ".burr/memory/playbooks/old-local.md",
          home,
        });
        expect(promoted.ok).toBe(true);
        if (!promoted.ok) return;
        expect(promoted.path.replaceAll("\\", "/")).toBe("~/.burr/memory/playbooks/old-local.md");
        const written = await readFile(join(home, ".burr", "memory", "playbooks", "old-local.md"), "utf8");
        expect(written).not.toContain("ada@example.com");
        expect(written).not.toContain("/Users/alex");
        expect(written).toMatch(/\[EMAIL\]|\[HOME\]|\[REDACTED\]/);
        const verbs = (await readUsage(dir)).map((event) => event.verb);
        expect(verbs).toContain("promote");
      });
    });
  });

  it("does not overwrite a different shared playbook during legacy promotion", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const shared = join(home, ".burr", "memory", "playbooks");
        const legacy = join(dir, ".burr", "memory", "playbooks");
        await mkdir(shared, { recursive: true });
        await mkdir(legacy, { recursive: true });
        await writeFile(join(shared, "same-name.md"), "# Existing shared fix\n");
        await writeFile(
          join(legacy, "same-name.md"),
          "---\ntitle: Different fix\nkind: playbook\n---\n# Different fix\n",
        );

        const promoted = await promotePlaybook(dir, {
          path: ".burr/memory/playbooks/same-name.md",
          home,
        });

        expect(promoted.ok).toBe(true);
        if (!promoted.ok) return;
        expect(promoted.path).not.toBe("~/.burr/memory/playbooks/same-name.md");
        expect(await readFile(join(shared, "same-name.md"), "utf8")).toBe(
          "# Existing shared fix\n",
        );
        expect(await readdir(shared)).toHaveLength(2);
      });
    });
  });

  it("promote without a path finds the latest leftover project playbook", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const playbooks = join(dir, ".burr", "memory", "playbooks");
        await mkdir(playbooks, { recursive: true });
        await writeFile(
          join(playbooks, "old-local.md"),
          "---\ntitle: Old local\nkind: playbook\n---\n# Old local\n",
        );
        await appendUsage(dir, {
          verb: "resolve",
          path: ".burr/memory/playbooks/old-local.md",
        });
        await verifiedPlaybook(dir, home);

        const promoted = await promotePlaybook(dir, { home });

        expect(promoted).toEqual({
          ok: true,
          path: "~/.burr/memory/playbooks/old-local.md",
        });
      });
    });
  });

  it("promote without a path discovers a leftover file without ledger history", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const playbooks = join(dir, ".burr", "memory", "playbooks");
        await mkdir(playbooks, { recursive: true });
        await writeFile(
          join(playbooks, "unledgered.md"),
          "---\ntitle: Unledgered\nkind: playbook\n---\n# Unledgered\n",
        );

        const promoted = await promotePlaybook(dir, { home });

        expect(promoted).toEqual({
          ok: true,
          path: "~/.burr/memory/playbooks/unledgered.md",
        });
      });
    });
  });

  it("ignores a stale ledger path when another leftover playbook exists", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const playbooks = join(dir, ".burr", "memory", "playbooks");
        await mkdir(playbooks, { recursive: true });
        await appendUsage(dir, {
          verb: "resolve",
          path: ".burr/memory/playbooks/deleted.md",
        });
        await writeFile(
          join(playbooks, "still-here.md"),
          "---\ntitle: Still here\nkind: playbook\n---\n# Still here\n",
        );

        const promoted = await promotePlaybook(dir, { home });

        expect(promoted).toEqual({
          ok: true,
          path: "~/.burr/memory/playbooks/still-here.md",
        });
      });
    });
  });

  it("refuses to promote a signal", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const captured = await captureSignal(
          dir,
          {
            error: "TypeError: Cannot read properties of undefined (reading 'id')",
            whyKeep: "API dropped the id field",
          },
          { home },
        );
        expect(captured.ok).toBe(true);
        if (!captured.ok) return;
        const promoted = await promotePlaybook(dir, { path: captured.path, home });
        expect(promoted).toEqual({ ok: false, reason: "not-a-playbook" });
      });
    });
  });

  it("returns global hits before higher-scoring legacy project hits", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        const shared = join(home, ".burr", "memory", "playbooks");
        const legacy = join(dir, ".burr", "memory", "playbooks");
        await mkdir(shared, { recursive: true });
        await mkdir(legacy, { recursive: true });
        await writeFile(join(shared, "hydration.md"), "# Hydration mismatch\n");
        await writeFile(
          join(legacy, "hydration-timezone-utc.md"),
          "# Hydration mismatch timezone UTC hydration timezone UTC\n",
        );

        const { hits } = await runSearch(dir, "hydration mismatch timezone UTC", { home });

        expect(hits[0]?.source).toBe("global");
      });
    });
  });
});

describe("cli resolve is shared", () => {
  it("prints a user-store path after resolve", async () => {
    await withTempDir(async (home) => {
      await withTempDir(async (dir) => {
        process.env.BURR_HOME = home;
        const prev = process.cwd();
        process.chdir(dir);
        const logs: string[] = [];
        const orig = console.log;
        console.log = (line?: unknown) => {
          logs.push(String(line ?? ""));
        };
        try {
          expect(
            await main([
              "resolve",
              "--error",
              "TypeError: Cannot read properties of undefined (reading 'id')",
              "--cause",
              "Prisma client was constructed in every Next.js route module",
              "--fix",
              "Export one PrismaClient singleton from lib/prisma",
              "--verify",
              "npm test — 12 passed, 0 failing",
            ]),
          ).toBe(0);
        } finally {
          console.log = orig;
          process.chdir(prev);
        }
        expect(logs.join("\n")).toMatch(/~\/\.burr\/memory\/playbooks\/.+\.md/);
      });
    });
  });
});
