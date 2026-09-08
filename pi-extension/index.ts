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
      "Run `npx burr status` and report the result. If the user requests on, strict, or off, run `npx burr <mode>` instead.",
  },
  "burr-search": {
    description: "Search shared Burr memory",
    template:
      "Search `~/.burr/memory/` by running `npx burr search <query>` with the user's redacted error or context, then report the useful hits.",
  },
  "burr-capture": {
    description: "Capture a reusable failure",
    template:
      "For a reusable failure, run `npx burr capture --error <text>` with relevant optional flags. Redact sensitive data first.",
  },
  "burr-resolve": {
    description: "Write a verified Burr playbook",
    template:
      "Only after a real verification, run `npx burr resolve --error <text> --cause <text> --fix <text> --verify <text>`.",
  },
  "burr-promote": {
    description: "Promote a legacy project playbook",
    template:
      "Run `npx burr promote [path]` only for a legacy project playbook that belongs in shared Burr memory.",
  },
  "burr-audit": {
    description: "Audit Burr usage",
    template: "Run `npx burr audit` and summarize the local usage ledger.",
  },
  "burr-help": {
    description: "Show Burr command help",
    template: "Run `npx burr help` and present the command reference.",
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
      event: { systemPrompt?: string },
      ctx: { cwd?: string },
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
  return ctx?.cwd || process.cwd();
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
