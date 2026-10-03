import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { getSessionActions } from "../../src/runtime/action-ledger.js";
import { findPackageRoot } from "../../src/shared/package-root.js";
import { withTempDir, SKILL_NAMES } from "../helpers.js";

// Point BURR_PI_PACKAGE at an installed Pi package; no model or credentials are used.
it.skipIf(!process.env.BURR_PI_PACKAGE)(
  "loads Burr through Pi's native loader and lifecycle runner",
  async () => {
    await withTempDir(async (root) => {
      const previous = process.env.BURR_HOME;
      process.env.BURR_HOME = root;
      try {
        const native = (file: string) =>
          import(
            pathToFileURL(
              join(process.env.BURR_PI_PACKAGE!, "dist", "core", file),
            ).href
          );
        const { loadExtensions } = await native("extensions/loader.js");
        const { ExtensionRunner } = await native("extensions/runner.js");
        const { SessionManager } = await native("session-manager.js");
        const promptApi = await native("system-prompt.js");
        const structuredPrompt =
          typeof promptApi.normalizeBuildSystemPromptOptions === "function";
        const basePrompt = structuredPrompt
          ? { cwd: root, forceSystemPrompt: "base" }
          : "base";
        const loaded = await loadExtensions(
          [join(findPackageRoot(), "pi-extension", "index.ts")],
          root,
        );
        expect(loaded.errors).toEqual([]);
        expect(loaded.extensions).toHaveLength(1);
        const session = SessionManager.inMemory(root);
        const runner = new ExtensionRunner(
          loaded.extensions,
          loaded.runtime,
          root,
          session,
          {},
        );
        const errors: unknown[] = [];
        runner.onError((error: unknown) => errors.push(error));
        expect(
          runner
            .getRegisteredCommands()
            .map((command: { name: string }) => command.name),
        ).toEqual(SKILL_NAMES);
        const beforeStart = () =>
          runner.emitBeforeAgentStart("synthetic", undefined, basePrompt);
        const effectivePrompt = (
          result:
            | { systemPrompt?: string; systemPromptOptions?: unknown }
            | undefined,
        ) =>
          structuredPrompt
            ? promptApi.buildSystemPrompt(result?.systemPromptOptions)
            : (result?.systemPrompt ?? "base");
        const started = await beforeStart();
        expect(errors).toEqual([]);
        expect(effectivePrompt(started)).toContain(
          "Burr is local debugging memory",
        );
        expect(effectivePrompt(started)).toContain("base");
        const input = {
          type: "tool_call",
          toolCallId: "synthetic-call",
          toolName: "bash",
          input: { command: "exit 1" },
        };
        expect(await runner.emitToolCall(input)).toBeUndefined();
        await runner.emitToolResult({
          ...input,
          type: "tool_result",
          content: [{ type: "text", text: "synthetic failure" }],
          isError: true,
        });
        expect(
          (await getSessionActions(root, session.getSessionId()))[0]?.status,
        ).toBe("failed");
        await mkdir(join(root, ".burr"), { recursive: true });
        await writeFile(
          join(root, ".burr", "config.json"),
          '{"runtime":{"blockScore":0}}',
        );
        expect(
          await runner.emitToolCall({ ...input, toolCallId: "blocked-call" }),
        ).toMatchObject({ block: true });
        await writeFile(join(root, ".burr", "config.json"), '{"mode":"off"}');
        expect(effectivePrompt(await beforeStart())).toBe("base");
        expect(
          await runner.emitToolCall({ ...input, toolCallId: "off-call" }),
        ).toBeUndefined();
        expect(errors).toEqual([]);
      } finally {
        if (previous === undefined) delete process.env.BURR_HOME;
        else process.env.BURR_HOME = previous;
      }
    });
  },
  90000,
);
