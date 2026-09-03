import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIfMissing } from "./fs.js";
import { ensureBurrGitignore } from "./gitignore.js";
import { findPackageRoot } from "./package-root.js";

let cachedTemplates: { instructions: string; config: string } | null = null;

async function loadTemplates(pack: string): Promise<{ instructions: string; config: string }> {
  if (cachedTemplates) return cachedTemplates;
  const [instructions, config] = await Promise.all([
    readFile(join(pack, "templates", "instructions.md"), "utf8"),
    readFile(join(pack, "templates", "config.json"), "utf8"),
  ]);
  cachedTemplates = {
    instructions: instructions.endsWith("\n") ? instructions : `${instructions}\n`,
    config: config.endsWith("\n") ? config : `${config}\n`,
  };
  return cachedTemplates;
}

export async function ensureStore(root: string): Promise<void> {
  const pack = findPackageRoot();
  const { instructions, config } = await loadTemplates(pack);
  await writeIfMissing(root, join(root, ".burr", "config.json"), config);
  await writeIfMissing(root, join(root, ".burr", "instructions.md"), instructions);
  await writeIfMissing(root, join(root, ".burr", "usage.jsonl"), "");
  await ensureBurrGitignore(root);
}
