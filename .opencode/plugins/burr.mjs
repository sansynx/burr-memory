// burr-managed: 2
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const USER_HOME = process.env.BURR_HOME || homedir();
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
};

function projectRoot(ctx) {
  return ctx?.worktree || ctx?.directory || process.cwd();
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function loadMode(root) {
  const config = readJson(join(root, ".burr", "config.json"));
  const mode = config?.mode;
  return mode === "strict" || mode === "off" || mode === "on" ? mode : "on";
}

function loadInstructions(root, mode) {
  const global = join(USER_HOME, ".config", "opencode", "burr-instructions.md");
  const instructions = readText(global) || DEFAULT_INSTRUCTIONS;
  const currentMode = mode || loadMode(root);
  return currentMode === "strict" ? `${instructions}${STRICT_INSTRUCTIONS}` : instructions;
}

async function attachV2(ctx, root) {
  if (typeof ctx?.command?.transform === "function") {
    await ctx.command.transform((list) => {
      for (const [name, command] of Object.entries(COMMANDS)) {
        list.update(name, (draft) => {
          draft.description = command.description;
          draft.template = command.template;
        });
      }
    });
  }

  if (typeof ctx?.session?.hook === "function") {
    await ctx.session.hook("context", (event) => {
      const mode = loadMode(root);
      if (mode === "off") return;
      const instructions = loadInstructions(root, mode);
      if (!instructions) return;
      if (Array.isArray(event.system)) event.system.push(instructions);
    });
  }
}

export default async function burr(ctx) {
  const root = projectRoot(ctx);

  if (ctx?.id === undefined && typeof ctx?.setup !== "function") {
    await attachV2(ctx, root);
  }

  return {
    command: COMMANDS,
    "experimental.chat.system.transform": async (_input, output) => {
      const mode = loadMode(root);
      if (mode === "off") return;
      const instructions = loadInstructions(root, mode);
      if (instructions && Array.isArray(output?.system)) {
        output.system.push(instructions);
      }
    },
  };
}
