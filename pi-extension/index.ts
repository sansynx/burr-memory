import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_INSTRUCTIONS = `Burr is local debugging memory for coding agents.

Before a non-trivial fix, search ~/.burr/memory/. Capture reusable failures only after redacting sensitive data. Write shared playbooks only after a real verification. Keep Burr offline.`;
const STRICT_INSTRUCTIONS =
  "\n\nStrict mode: do not modify code for a non-trivial fix until you have searched shared Burr memory.";
const COMMANDS = {
  burr: { description: "Show Burr status or set its mode", template: "Use Burr status or mode controls." },
  "burr-search": {
    description: "Search shared Burr memory",
    template: "Search `~/.burr/memory/` before a non-trivial fix.",
  },
  "burr-capture": {
    description: "Capture a reusable failure",
    template: "Capture only reusable failures after redacting sensitive data.",
  },
  "burr-resolve": {
    description: "Write a verified Burr playbook",
    template: "Write a Burr playbook only after a real verification.",
  },
  "burr-promote": {
    description: "Promote a legacy project playbook",
    template: "Promote a legacy project playbook into shared Burr memory.",
  },
  "burr-audit": { description: "Audit Burr usage", template: "Audit Burr usage from the local ledger." },
  "burr-help": { description: "Show Burr command help", template: "Show the Burr command reference." },
} as const;

type PiApi = {
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
    const config = JSON.parse(readFileSync(join(root, ".burr", "config.json"), "utf8"));
    if (config?.mode === "strict" || config?.mode === "off" || config?.mode === "on") {
      return config.mode;
    }
  } catch {
    // missing config stays on
  }
  return "on";
}

function loadInstructions(root: string): string {
  const packed = join(PACKAGE_ROOT, "templates", "instructions.md");
  const instructions = readText(packed) || DEFAULT_INSTRUCTIONS;
  return loadMode(root) === "strict" ? `${instructions}${STRICT_INSTRUCTIONS}` : instructions;
}

export default function burr(pi: PiApi): void {
  for (const [name, command] of Object.entries(COMMANDS)) {
    pi.registerCommand?.(name, {
      description: command.description,
      handler: async (args, ctx) => {
        const prompt = [command.template, args ? `\nArguments: ${args}` : ""]
          .join("")
          .trim();
        const send = (ctx as { sendMessage?: (text: string) => Promise<void> }).sendMessage;
        if (send) await send(prompt);
      },
    });
  }

  pi.on?.("before_agent_start", async (event, ctx) => {
    const root = projectRoot(ctx);
    if (loadMode(root) === "off") return;
    const instructions = loadInstructions(root);
    if (!instructions) return;
    return {
      systemPrompt: `${event.systemPrompt ?? ""}\n\n${instructions}`.trim(),
    };
  });
}
