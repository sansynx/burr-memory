import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { runGlobal } from "../../src/cli/global.js";
import { runInit } from "../../src/cli/init.js";
import { mergeOpenCodePlugin } from "../../src/shared/opencode.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { withTempDir } from "../helpers.js";
import { handlePostToolUse } from "../../src/codex/hooks.js";
import { getSessionActions } from "../../src/runtime/action-ledger.js";

it("preserves edited older managed global files", async () => {
  await withTempDir(async (home) => {
    const file = join(home, ".agents", "skills", "burr", "SKILL.md");
    await mkdir(join(home, ".agents", "skills", "burr"), { recursive: true });
    const edited = "<!-- burr-managed: 1 -->\nMy custom instructions\n";
    await writeFile(file, edited);
    await runGlobal({ home });
    expect(await readFile(file, "utf8")).toBe(edited);
  });
});

it("resolves the plugin relative to each OpenCode config", async () => {
  await withTempDir(async (root) => {
    await runInit(root);
    const nested = JSON.parse(
      await readFile(join(root, ".opencode", "opencode.json"), "utf8"),
    );
    expect(nested.plugin).toContain("./plugins/burr.mjs");
    expect(nested.plugin).not.toContain("./.opencode/plugins/burr.mjs");
  });
});

it("refreshes an unchanged generated adapter while preserving edited copies", async () => {
  await withTempDir(async (root) => {
    await runInit(root);
    const file = join(root, ".opencode", "plugins", "burr.mjs");
    const previous = await readFile(
      join(findPackageRoot(), "test", "fixtures", "opencode-v2.mjs"),
      "utf8",
    );
    await writeFile(
      file,
      previous.replace(
        'new URL("../../dist/codex/index.js", import.meta.url).href',
        JSON.stringify("file:///synthetic-old-location/index.js"),
      ),
    );
    await runInit(root);
    const updated = await readFile(file, "utf8");
    expect(updated).toContain("config: async");
    const edited = `${updated}\n// User custom behavior\n`;
    await writeFile(file, edited);
    await runInit(root);
    expect(await readFile(file, "utf8")).toBe(edited);
  });
});

it("preserves unsupported OpenCode plugin configuration", async () => {
  await withTempDir(async (root) => {
    const file = join(root, "opencode.json");
    const original = '{"plugin":"custom","model":"kept"}';
    await writeFile(file, original);
    expect(await mergeOpenCodePlugin(root, "opencode.json", "./burr.mjs")).toBe(
      "skipped",
    );
    expect(await readFile(file, "utf8")).toBe(original);
  });
});

it("registers OpenCode commands through its supported config hook without replacing user commands", async () => {
  const plugin = await import(
    pathToFileURL(join(findPackageRoot(), ".opencode", "plugins", "burr.mjs"))
      .href
  );
  const hooks = await plugin.default({});
  const config = { command: { burr: { template: "custom" } } };
  await hooks.config(config);
  expect(config.command.burr.template).toBe("custom");
  expect(config.command).toHaveProperty("burr-search");
});

it("declares always-on Windsurf activation", async () => {
  await withTempDir(async (root) => {
    await runInit(root);
    expect(
      await readFile(join(root, ".windsurf", "rules", "burr.md"), "utf8"),
    ).toMatch(/^---\r?\ntrigger: always_on\r?\n---/);
  });
});

it("does not claim unsupported global editor rule installation", async () => {
  await withTempDir(async (home) => {
    const logs: string[] = [];
    const result = await runGlobal({ home, log: (line) => logs.push(line) });
    expect(
      result.created.some((path) => /\.(cursor|windsurf)\//.test(path)),
    ).toBe(false);
    expect(logs.join("\n")).toContain("Cursor and Windsurf");
  });
});

it("uses the current tool output for stagnation", async () => {
  await withTempDir(async (home) => {
    const options = { home, root: home };
    await handlePostToolUse(
      {
        sessionId: "stagnation",
        tool: "search",
        args: { q: "a" },
        output: "same",
      },
      options,
    );
    const second = await handlePostToolUse(
      {
        sessionId: "stagnation",
        tool: "search",
        args: { q: "b" },
        output: "same",
      },
      options,
    );
    expect(second.stagnationDetected).toBe(true);
    const progressing = await handlePostToolUse(
      {
        sessionId: "stagnation",
        tool: "search",
        args: { q: "c" },
        output: "different",
      },
      options,
    );
    expect(progressing.stagnationDetected).toBe(false);
  });
});

it("records a failed command even when its error output is empty", async () => {
  await withTempDir(async (home) => {
    await handlePostToolUse(
      {
        sessionId: "silent-failure",
        tool: "bash",
        args: { command: "exit 1" },
        output: "",
        error: "",
      },
      { home, root: home },
    );
    expect((await getSessionActions(home, "silent-failure"))[0]?.status).toBe(
      "failed",
    );
  });
});

it("honors ancestor off mode in Pi", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".burr"));
    await mkdir(join(root, "child"));
    await writeFile(join(root, ".burr", "config.json"), '{"mode":"off"}');
    const plugin = await import(
      pathToFileURL(join(findPackageRoot(), "pi-extension", "index.ts")).href
    );
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => Promise<unknown>
    >();
    plugin.default({
      on: (
        name: string,
        handler: (event: unknown, ctx: unknown) => Promise<unknown>,
      ) => handlers.set(name, handler),
    });
    expect(
      await handlers.get("before_agent_start")!(
        { systemPrompt: "base" },
        { cwd: join(root, "child") },
      ),
    ).toBeUndefined();
  });
});

it("honors OpenCode off mode outside a Git worktree", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".burr"));
    await writeFile(join(root, ".burr", "config.json"), '{"mode":"off"}');
    const plugin = await import(
      pathToFileURL(join(findPackageRoot(), ".opencode", "plugins", "burr.mjs"))
        .href
    );
    const hooks = await plugin.default({ directory: root, worktree: "/" });
    const output = { system: [] };
    await hooks["experimental.chat.system.transform"]({}, output);
    expect(output.system).toEqual([]);
  });
});

it("records an OpenCode shell failure from exit metadata", async () => {
  await withTempDir(async (root) => {
    const previous = process.env.BURR_HOME;
    process.env.BURR_HOME = root;
    try {
      const plugin = await import(
        pathToFileURL(
          join(findPackageRoot(), ".opencode", "plugins", "burr.mjs"),
        ).href
      );
      const hooks = await plugin.default({ directory: root });
      await hooks["tool.execute.after"](
        {
          sessionID: "failed-shell",
          tool: "bash",
          args: { command: "exit 1" },
        },
        { output: "synthetic failure", metadata: { exit: 1 } },
      );
      expect((await getSessionActions(root, "failed-shell"))[0]?.status).toBe(
        "failed",
      );
    } finally {
      if (previous === undefined) delete process.env.BURR_HOME;
      else process.env.BURR_HOME = previous;
    }
  });
});

it("records duplicate OpenCode adapter deliveries once", async () => {
  await withTempDir(async (root) => {
    const previous = process.env.BURR_HOME;
    process.env.BURR_HOME = root;
    try {
      const plugin = await import(
        pathToFileURL(
          join(findPackageRoot(), ".opencode", "plugins", "burr.mjs"),
        ).href
      );
      const first = await plugin.default({ directory: root });
      const second = await plugin.default({ directory: root });
      const input = {
        sessionID: "duplicate-delivery",
        callID: root,
        tool: "bash",
        args: { command: "echo synthetic" },
      };
      await Promise.all([
        first["tool.execute.after"](input, { output: "synthetic" }),
        second["tool.execute.after"](input, { output: "synthetic" }),
      ]);
      expect(await getSessionActions(root, input.sessionID)).toHaveLength(1);
    } finally {
      if (previous === undefined) delete process.env.BURR_HOME;
      else process.env.BURR_HOME = previous;
    }
  });
});
