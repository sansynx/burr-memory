import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeIfMissing } from "./fs.js";
import { ensureBurrGitignore } from "./gitignore.js";
import { findPackageRoot } from "./package-root.js";

export async function ensureStore(root: string): Promise<void> {
  const pack = findPackageRoot();
  const instructions = await readFile(join(pack, "templates", "instructions.md"), "utf8");
  const config = await readFile(join(pack, "templates", "config.json"), "utf8");
  await writeIfMissing(root, join(root, ".burr", "config.json"), config.endsWith("\n") ? config : `${config}\n`);
  await writeIfMissing(
    root,
    join(root, ".burr", "instructions.md"),
    instructions.endsWith("\n") ? instructions : `${instructions}\n`,
  );
  await writeIfMissing(root, join(root, ".burr", "usage.jsonl"), "");
  await ensureBurrGitignore(root);
}
