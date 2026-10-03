import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { codexHookCommand, mergeCodexHooks } from "../../src/shared/codex.js";
import { findPackageRoot } from "../../src/shared/package-root.js";

async function withNativeDir(run: (root: string) => Promise<void>) {
  // Codex refuses Windows sandbox helpers beneath the OS temporary directory.
  const base =
    process.env.BURR_CODEX_TEST_ROOT ?? join(findPackageRoot(), ".local");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, "codex-native-"));
  try {
    await run(root);
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  }
}

// Opt in with the path to an installed Codex bin/codex.js; no live model or credentials are used.
it.skipIf(!process.env.BURR_CODEX_CLI).each([
  { block: true, label: "denial" },
  { block: false, label: "observation" },
])(
  "Codex native hook $label",
  async ({ block }) => {
    await withNativeDir(async (root) => {
      const home = join(root, "codex-home");
      await mkdir(home);
      await mkdir(join(root, ".burr"));
      await writeFile(join(root, "synthetic.txt"), "BURR_NATIVE_TEST\n");
      await mergeCodexHooks(
        home,
        "hooks.json",
        codexHookCommand(findPackageRoot()),
      );
      await mergeCodexHooks(
        root,
        ".codex/hooks.json",
        codexHookCommand(findPackageRoot()),
      );
      const memory = join(root, block ? "blocked-memory" : "allowed-memory");
      await mkdir(memory);
      await writeFile(
        join(root, ".burr", "config.json"),
        JSON.stringify({ runtime: { blockScore: block ? 0 : 100 } }),
      );
      const requests: string[] = [];
      let toolName = "shell_command";
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        requests.push(Buffer.concat(chunks).toString());
        const body = JSON.parse(requests.at(-1)!);
        if (requests.length === 1) {
          toolName = body.tools.some(
            (tool: { name?: string }) => tool.name === "exec_command",
          )
            ? "exec_command"
            : "shell_command";
        }
        const id = `response_${requests.length}`;
        const item =
          requests.length === 1
            ? {
                id: "call_item",
                type: "function_call",
                call_id: "call_synthetic",
                name: toolName,
                arguments: JSON.stringify({
                  [toolName === "exec_command" ? "cmd" : "command"]:
                    process.platform === "win32"
                      ? "Get-Content -LiteralPath synthetic.txt"
                      : "cat synthetic.txt",
                  ...(toolName === "exec_command" &&
                  process.platform === "win32"
                    ? {
                        shell:
                          "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
                      }
                    : {}),
                  login: false,
                }),
              }
            : {
                id: "message_item",
                type: "message",
                role: "assistant",
                content: [
                  {
                    type: "output_text",
                    text: "Native hook test finished.",
                    annotations: [],
                  },
                ],
              };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const event of [
          {
            type: "response.created",
            response: { id, status: "in_progress", output: [] },
          },
          { type: "response.output_item.added", output_index: 0, item },
          { type: "response.output_item.done", output_index: 0, item },
          {
            type: "response.completed",
            response: {
              id,
              status: "completed",
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            },
          },
        ])
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      try {
        const port = (server.address() as { port: number }).port;
        await writeFile(
          join(home, "config.toml"),
          `model = "gpt-5.4"\nmodel_provider = "burr_test"\n[projects.${JSON.stringify(root.replaceAll("\\", "/"))}]\ntrust_level = "trusted"\n[model_providers.burr_test]\nname = "Burr local test"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n${process.platform === "win32" ? '[windows]\nsandbox = "unelevated"\n' : ""}`,
        );
        const result = await new Promise<{
          code: number | null;
          output: string;
        }>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              process.env.BURR_CODEX_CLI!,
              "exec",
              "--skip-git-repo-check",
              "--ephemeral",
              "--dangerously-bypass-hook-trust",
              "-s",
              "workspace-write",
              "--json",
              "--disable",
              "remote_plugin",
              "--disable",
              "plugins",
              "--disable",
              "apps",
              "--disable",
              "browser_use",
              "--disable",
              "computer_use",
              "--disable",
              "workspace_dependencies",
              "--disable",
              "shell_snapshot",
              // Keep this protocol smoke test on the portable shell tool.
              "--disable",
              "unified_exec",
              "--enable",
              "skip_host_skill_discovery",
              "Run the synthetic command once.",
            ],
            {
              cwd: root,
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    ([key]) => !/^(?:CODEX_|OPENAI_)/i.test(key),
                  ),
                ),
                CODEX_HOME: home,
                HOME: home,
                USERPROFILE: home,
                BURR_HOME: memory,
                HTTP_PROXY: "http://127.0.0.1:9",
                HTTPS_PROXY: "http://127.0.0.1:9",
                NO_PROXY: "127.0.0.1,localhost",
              },
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            },
          );
          let output = "";
          child.stdout.on("data", (chunk) => {
            output += chunk;
          });
          child.stderr.on("data", (chunk) => {
            output += chunk;
          });
          const timer = setTimeout(() => {
            if (process.platform === "win32" && child.pid) {
              spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
                windowsHide: true,
                stdio: "ignore",
              });
            } else child.kill();
            output += "\nCodex native test timed out";
          }, 120000);
          child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code, output });
          });
        });
        expect(
          result.code,
          `${block ? "Denial" : "Observation"}; provider requests: ${requests.length}\n${result.output}`,
        ).toBe(0);
        expect(requests.length, result.output).toBeGreaterThanOrEqual(2);
        if (!block)
          expect(requests.join("\n"), result.output).toContain(
            "BURR_NATIVE_TEST",
          );
        const files = await readdir(join(memory, ".burr", "runs"));
        const actions = (
          await Promise.all(
            files
              .filter((file) => file.endsWith(".jsonl"))
              .map((file) =>
                readFile(join(memory, ".burr", "runs", file), "utf8"),
              ),
          )
        )
          .join("")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
        expect(
          actions.some(
            (action) => action.status === (block ? "blocked" : "completed"),
          ),
          result.output,
        ).toBe(true);
        expect(actions).toHaveLength(1);
        if (block)
          expect(actions.some((action) => action.status === "completed")).toBe(
            false,
          );
        else
          expect(
            actions.some((action) =>
              action.outputSnippet?.includes("BURR_NATIVE_TEST"),
            ),
          ).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  },
  180000,
);
