import { once } from "node:events";
import type { Server } from "node:http";
import { get } from "node:http";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runDashboard } from "../../src/cli/dashboard.js";
import { saveMemoryItem } from "../../src/learning/consolidator.js";
import { withTempDir } from "../helpers.js";

const servers = vi.hoisted(() => [] as Server[]);
vi.mock("node:http", async (importOriginal) => {
  const http = await importOriginal<typeof import("node:http")>();
  return {
    ...http,
    createServer: (...args: Parameters<typeof http.createServer>) => {
      const server = http.createServer(...args);
      servers.push(server);
      return server;
    },
  };
});

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function withDashboard(fn: (url: string, home: string) => Promise<void>) {
  await withTempDir(async (home) => {
    const listeners = new Set(process.listeners("SIGINT"));
    void runDashboard({ home, port: 0 });
    const server = servers.at(-1)!;
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No address");
    try {
      await fn(`http://127.0.0.1:${address.port}`, home);
    } finally {
      for (const listener of process.listeners("SIGINT")) {
        if (!listeners.has(listener))
          process.removeListener("SIGINT", listener);
      }
    }
  });
}

describe("local dashboard", () => {
  it("counts and displays only active memories", async () => {
    await withDashboard(async (url, home) => {
      for (const status of ["active", "stale", "archived"] as const) {
        await saveMemoryItem(
          {
            id: `fixture-${status}`,
            title: "Synthetic fixture",
            statement: "Synthetic fixture",
            type: "knowledge",
            status,
            scope: { level: "global" },
            confidence: 0.8,
            evidence: {
              observed: 1,
              successfulReuse: 0,
              failedReuse: 0,
              lastUsed: new Date().toISOString(),
              sessionIds: [],
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          home,
        );
      }
      const stats = await (await fetch(`${url}/api/stats`)).json();
      expect(stats.memory.active).toBe(1);
      expect(stats.memory.archived).toBe(1);
      const memories = await (await fetch(`${url}/api/memories`)).json();
      expect(memories.map((item: { status: string }) => item.status)).toEqual([
        "active",
      ]);
    });
  });
  it("serves local data without allowing cross-origin reads", async () => {
    await withDashboard(async (url) => {
      const response = await fetch(`${url}/api/stats`);
      expect(response.status).toBe(200);
      expect((await response.json()).memory.active).toBe(0);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      const foreign = await fetch(`${url}/api/stats`, {
        headers: { Origin: "https://example.com" },
      });
      expect(foreign.status).toBe(403);
    });
  });

  it("rejects foreign hosts used for DNS rebinding", async () => {
    await withDashboard(async (url) => {
      const status = await new Promise<number | undefined>(
        (resolve, reject) => {
          get(
            `${url}/api/memories`,
            { headers: { Host: "example.com" } },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          ).on("error", reject);
        },
      );
      expect(status).toBe(403);
    });
  });

  it("renders untrusted memory and run fields as text", async () => {
    await withDashboard(async (url) => {
      const html = await (await fetch(url)).text();
      const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
      const elements = new Map<
        string,
        { innerHTML: string; innerText: string }
      >();
      const payload = '<img src=x onerror="alert(1)">';
      const stats = await (await fetch(`${url}/api/stats`)).json();
      const data: Record<string, unknown> = {
        "/api/stats": stats,
        "/api/progression": [],
        "/api/memories": [
          {
            id: payload,
            type: payload,
            scope: { repo: payload },
            confidence: 0.8,
            statement: payload,
            evidence: { successfulReuse: 0, failedReuse: 0 },
          },
        ],
        "/api/runs": [
          {
            sessionId: payload,
            harness: payload,
            toolCalls: 1,
            failedCalls: 0,
            loopsDetected: 0,
            durationMs: 10,
            verified: true,
          },
        ],
      };
      await runInNewContext(script + "; refreshDashboard();", {
        fetch: async (path: string) => ({
          ok: true,
          json: async () => data[path],
        }),
        document: {
          getElementById: (id: string) => {
            if (!elements.has(id))
              elements.set(id, { innerHTML: "", innerText: "" });
            return elements.get(id);
          },
        },
        location: { host: new URL(url).host },
        console,
        setInterval: () => 0,
      });
      for (const id of ["memoriesTable", "runsTable"]) {
        expect(elements.get(id)!.innerHTML).not.toContain("<img");
        expect(elements.get(id)!.innerHTML).toContain("&lt;img");
      }
    });
  });
});
