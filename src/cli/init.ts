import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIfMissing, resolveProjectRoot } from "../shared/fs.js";
import { findPackageRoot } from "../shared/package-root.js";

const SKILLS = [
  "burr",
  "burr-search",
  "burr-capture",
  "burr-resolve",
  "burr-audit",
  "burr-help",
] as const;

const PLUGIN_PATH = "./.opencode/plugins/burr.mjs";
const CURSOR_FRONTMATTER = `---
description: Local debugging memory. Search .burr before non-trivial fixes.
alwaysApply: true
---

`;

export interface InitResult {
  created: string[];
  skipped: string[];
  untouchedInstructions: true;
}

export interface InitOptions {
  log?: (line: string) => void;
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

async function mergePluginJson(
  root: string,
  file: string,
  plugin: string,
): Promise<"created" | "skipped"> {
  const dest = join(root, file);
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(await readFile(dest, "utf8")) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      data = {};
    } else if (error instanceof SyntaxError) {
      return "skipped";
    } else {
      throw error;
    }
  }
  const list = Array.isArray(data.plugin) ? [...(data.plugin as string[])] : [];
  if (list.includes(plugin)) return "skipped";
  data.plugin = [...list, plugin];
  const { writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, `${JSON.stringify(data, null, 2)}\n`);
  return "created";
}

export async function runInit(cwd: string, options: InitOptions = {}): Promise<InitResult> {
  const log = options.log ?? (() => undefined);
  const root = await resolveProjectRoot(cwd);
  const pack = findPackageRoot();
  const created: string[] = [];
  const skipped: string[] = [];

  const note = async (rel: string, result: "created" | "skipped") => {
    const path = posix(rel);
    if (result === "created") created.push(path);
    else skipped.push(path);
  };

  const write = async (rel: string, data: string) => {
    const result = await writeIfMissing(root, join(root, rel), data);
    await note(rel, result);
  };

  const instructions = await readFile(join(pack, "templates", "instructions.md"), "utf8");
  const config = await readFile(join(pack, "templates", "config.json"), "utf8");
  const plugin = await readFile(join(pack, ".opencode", "plugins", "burr.mjs"), "utf8");

  await mkdir(join(root, ".burr", "memory", "playbooks"), { recursive: true });
  await mkdir(join(root, ".burr", "memory", "signals"), { recursive: true });

  await write(".burr/config.json", config.endsWith("\n") ? config : `${config}\n`);
  await write(".burr/instructions.md", instructions.endsWith("\n") ? instructions : `${instructions}\n`);
  await write(".burr/usage.jsonl", "");

  for (const name of SKILLS) {
    const skill = await readFile(join(pack, "skills", name, "SKILL.md"), "utf8");
    for (const tree of [".burr/skills", ".claude/skills", ".agents/skills", ".pi/skills"]) {
      await write(`${tree}/${name}/SKILL.md`, skill);
    }
    await write(`.opencode/command/${name}.md`, skill);
  }

  await write(".opencode/plugins/burr.mjs", plugin);
  await write(".cursor/rules/burr.mdc", `${CURSOR_FRONTMATTER}${instructions}`);
  await write(".windsurf/rules/burr.md", instructions.endsWith("\n") ? instructions : `${instructions}\n`);

  for (const file of ["opencode.json", ".opencode/opencode.json"]) {
    const result = await mergePluginJson(root, file, PLUGIN_PATH);
    await note(file, result);
  }

  log("Created:");
  if (created.length === 0) log("  (none)");
  for (const path of created) log(`  ${path}`);
  if (skipped.length) {
    log("Skipped (exists):");
    for (const path of skipped) log(`  ${path}`);
  }
  log("No existing instruction file was modified. Burr never edits AGENTS.md or CLAUDE.md.");
  log("No key asked. No network used.");

  return { created, skipped, untouchedInstructions: true };
}
