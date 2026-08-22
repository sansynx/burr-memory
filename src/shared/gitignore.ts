import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertInside, writeInside } from "./fs.js";

const ENTRY = ".burr/";

function hasBurrIgnore(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === ".burr/" || trimmed === ".burr";
  });
}

export async function ensureBurrGitignore(root: string): Promise<"created" | "skipped"> {
  const dest = assertInside(root, join(root, ".gitignore"));
  let existing = "";
  try {
    existing = await readFile(dest, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await writeInside(root, dest, `${ENTRY}\n`);
    return "created";
  }
  if (hasBurrIgnore(existing)) return "skipped";
  const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
  await writeInside(root, dest, `${prefix}${ENTRY}\n`);
  return "created";
}
