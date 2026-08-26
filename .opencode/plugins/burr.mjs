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

function loadInstructions(root) {
  const global = join(USER_HOME, ".config", "opencode", "burr-instructions.md");
  const instructions = readText(global) || DEFAULT_INSTRUCTIONS;
  return loadMode(root) === "strict" ? `${instructions}${STRICT_INSTRUCTIONS}` : instructions;
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
      if (loadMode(root) === "off") return;
      const instructions = loadInstructions(root);
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
      if (loadMode(root) === "off") return;
      const instructions = loadInstructions(root);
      if (instructions && Array.isArray(output?.system)) {
        output.system.push(instructions);
      }
    },
  };
}
