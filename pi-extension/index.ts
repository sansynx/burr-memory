import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_NAMES = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-audit",
  "burr-help",
] as const;

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

function skillDir(root: string): string {
  const owned = join(root, ".burr", "skills");
  if (existsSync(join(owned, "burr", "SKILL.md"))) return owned;
  return join(PACKAGE_ROOT, "skills");
}

function parseSkill(markdown: string): { description: string; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { description: "", body: markdown.trim() };
  return {
    description: match[1].match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "",
    body: match[2].trim(),
  };
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
  const project = join(root, ".burr", "instructions.md");
  if (existsSync(project)) return readFileSync(project, "utf8");
  const packed = join(PACKAGE_ROOT, "templates", "instructions.md");
  return existsSync(packed) ? readFileSync(packed, "utf8") : "";
}

export default function burr(pi: PiApi): void {
  for (const name of SKILL_NAMES) {
    const markdown = readText(join(skillDir(process.cwd()), name, "SKILL.md"));
    const parsed = parseSkill(markdown);
    pi.registerCommand?.(name, {
      description: parsed.description || `Burr ${name}`,
      handler: async (args, ctx) => {
        const prompt = [parsed.body, args ? `\nArguments: ${args}` : ""]
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
