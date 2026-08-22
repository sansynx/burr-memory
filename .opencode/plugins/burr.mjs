// burr-managed: 2
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const USER_HOME = process.env.BURR_HOME || homedir();
const SKILL_NAMES = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-promote",
  "burr-audit",
  "burr-help",
];

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

function skillDir(root) {
  const owned = join(root, ".burr", "skills");
  if (existsSync(join(owned, "burr", "SKILL.md"))) return owned;
  const global = join(USER_HOME, ".agents", "skills");
  if (existsSync(join(global, "burr", "SKILL.md"))) return global;
  return join(PACKAGE_ROOT, "skills");
}

function loadMode(root) {
  const config = readJson(join(root, ".burr", "config.json"));
  const mode = config?.mode;
  return mode === "strict" || mode === "off" || mode === "on" ? mode : "on";
}

function loadInstructions(root) {
  const project = join(root, ".burr", "instructions.md");
  if (existsSync(project)) return readFileSync(project, "utf8");
  const global = join(USER_HOME, ".config", "opencode", "burr-instructions.md");
  if (existsSync(global)) return readFileSync(global, "utf8");
  const packed = join(PACKAGE_ROOT, "templates", "instructions.md");
  return existsSync(packed) ? readFileSync(packed, "utf8") : "";
}

function parseSkill(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { description: "", body: markdown.trim() };
  const description =
    match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";
  return { description, body: match[2].trim() };
}

function loadCommands(root) {
  const dir = skillDir(root);
  const commands = {};
  for (const name of SKILL_NAMES) {
    const markdown = readText(join(dir, name, "SKILL.md"));
    if (!markdown) continue;
    const parsed = parseSkill(markdown);
    commands[name] = {
      description: parsed.description,
      template: parsed.body,
    };
  }
  return commands;
}

function skillSources(root) {
  const sources = [];
  const owned = join(root, ".burr", "skills");
  if (existsSync(owned)) sources.push(owned);
  const packed = join(PACKAGE_ROOT, "skills");
  if (existsSync(packed) && packed !== owned) sources.push(packed);
  return sources;
}

async function attachV2(ctx, root) {
  if (typeof ctx?.skill?.transform === "function") {
    await ctx.skill.transform((skills) => {
      if (typeof skills.source !== "function") return;
      for (const source of skillSources(root)) skills.source(source);
    });
  }

  if (typeof ctx?.command?.transform === "function") {
    const commands = loadCommands(root);
    await ctx.command.transform((list) => {
      for (const [name, command] of Object.entries(commands)) {
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
    command: loadCommands(root),
    "experimental.chat.system.transform": async (_input, output) => {
      if (loadMode(root) === "off") return;
      const instructions = loadInstructions(root);
      if (instructions && Array.isArray(output?.system)) {
        output.system.push(instructions);
      }
    },
  };
}
