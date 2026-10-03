import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INSTRUCTIONS = `Burr is local debugging memory for coding agents.

Before a non-trivial fix, search ~/.burr/memory/. Capture reusable failures only after redacting sensitive data. Write shared playbooks only after a real verification. Keep Burr offline.`;
const STRICT_INSTRUCTIONS =
  "\n\nStrict mode: do not modify code for a non-trivial fix until you have searched shared Burr memory.";
const COMMANDS = {
  burr: {
    description: "Show Burr status or set its mode",
    template:
      "Run `burr status` and report the result. If the user requests on, strict, or off, run `burr <mode>` instead.",
  },
  "burr-search": {
    description: "Search shared Burr memory",
    template:
      "Search `~/.burr/memory/` by running `burr search <query>` with the user's redacted error or context, then report the useful hits.",
  },
  "burr-capture": {
    description: "Capture a reusable failure",
    template:
      "For a reusable failure, run `burr capture --error <text>` with relevant optional flags. Redact sensitive data first.",
  },
  "burr-resolve": {
    description: "Write a verified Burr playbook",
    template:
      "Only after a real verification, run `burr resolve --error <text> --cause <text> --fix <text> --verify <text>`.",
  },
  "burr-promote": {
    description: "Promote a legacy project playbook",
    template:
      "Run `burr promote [path]` only for a legacy project playbook that belongs in shared Burr memory.",
  },
  "burr-audit": {
    description: "Audit Burr usage",
    template: "Run `burr audit` and summarize the local usage ledger.",
  },
  "burr-help": {
    description: "Show Burr command help",
    template: "Run `burr help` and present the command reference.",
  },
} as const;

type PiApi = {
  sendUserMessage: (text: string, options?: { deliverAs: "followUp" }) => void;
  registerCommand?: (
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: { cwd?: string }) => Promise<void> | void;
    },
  ) => void;
  on?: (
    event: string,
    handler: (
      event: {
        systemPrompt?: string;
        toolName?: string;
        input?: unknown;
        content?: unknown;
        isError?: boolean;
      },
      ctx: {
        cwd?: string;
        sessionManager?: { getSessionId(): string };
        ui?: { notify(message: string, level: "warning"): void };
      },
    ) => Promise<unknown> | unknown,
  ) => void;
};

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function projectRoot(ctx?: { cwd?: string }): string {
  const cwd = ctx?.cwd || process.cwd();
  let candidate = cwd;
  for (;;) {
    try {
      readFileSync(join(candidate, ".burr", "config.json"), "utf8");
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return cwd;
    candidate = parent;
  }
}

function loadMode(root: string): "on" | "strict" | "off" {
  try {
    const config = JSON.parse(
      readFileSync(join(root, ".burr", "config.json"), "utf8"),
    );
    if (
      config?.mode === "strict" ||
      config?.mode === "off" ||
      config?.mode === "on"
    ) {
      return config.mode;
    }
  } catch {
    // missing config stays on
  }
  return "on";
}

let cachedInstructions: string | null = null;

function loadInstructions(
  root: string,
  mode?: "on" | "strict" | "off",
): string {
  if (cachedInstructions === null) {
    const packed = join(PACKAGE_ROOT, "templates", "instructions.md");
    cachedInstructions = readText(packed) || DEFAULT_INSTRUCTIONS;
  }
  const currentMode = mode ?? loadMode(root);
  return currentMode === "strict"
    ? `${cachedInstructions}${STRICT_INSTRUCTIONS}`
    : cachedInstructions;
}

export default function burr(pi: PiApi): void {
  const runtime = () =>
    import(new URL("../dist/codex/index.js", import.meta.url).href) as Promise<
      typeof import("../src/codex/index.js")
    >;
  pi.on?.("tool_call", async (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId();
    if (!sessionId || !event.toolName || loadMode(projectRoot(ctx)) === "off")
      return;
    const result = await (
      await runtime()
    ).handlePreToolUse(
      { sessionId, tool: event.toolName, args: event.input ?? {} },
      { root: projectRoot(ctx), harness: "pi" },
    );
    if (!result.allow)
      return {
        block: true,
        reason: result.message ?? "Burr detected a repeated failing action.",
      };
    if (result.warning) ctx.ui?.notify(result.warning, "warning");
  });
  pi.on?.("tool_result", async (event, ctx) => {
    const sessionId = ctx.sessionManager?.getSessionId();
    if (!sessionId || !event.toolName || loadMode(projectRoot(ctx)) === "off")
      return;
    await (
      await runtime()
    ).handlePostToolUse(
      {
        sessionId,
        tool: event.toolName,
        args: event.input ?? {},
        output: event.content ?? "",
        error: event.isError
          ? JSON.stringify(event.content ?? "Tool failed")
          : undefined,
      },
      { root: projectRoot(ctx), harness: "pi" },
    );
  });
  for (const [name, command] of Object.entries(COMMANDS)) {
    pi.registerCommand?.(name, {
      description: command.description,
      handler: async (args) => {
        const prompt = [command.template, args ? `\nArguments: ${args}` : ""]
          .join("")
          .trim();
        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      },
    });
  }

  pi.on?.("before_agent_start", async (event, ctx) => {
    const root = projectRoot(ctx);
    const mode = loadMode(root);
    if (mode === "off") return;
    const instructions = loadInstructions(root, mode);
    if (!instructions) return;
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${instructions}`.trim(),
    };
  });
}
