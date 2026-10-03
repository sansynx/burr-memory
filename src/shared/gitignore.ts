import { join } from "node:path";
import { assertInside, readInside, withInsideLock, writeInside } from "./fs.js";

const ENTRY = ".burr/";

function hasBurrIgnore(text: string): boolean {
  return /^\s*\.burr\/?\s*$/m.test(text);
}

export async function ensureBurrGitignore(
  root: string,
): Promise<"created" | "skipped"> {
  const dest = assertInside(root, join(root, ".gitignore"));
  return withInsideLock(
    root,
    join(root, ".burr", "gitignore.lock"),
    async () => {
      let existing = "";
      try {
        existing = await readInside(root, dest);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeInside(root, dest, `${ENTRY}\n`);
        return "created";
      }
      if (hasBurrIgnore(existing)) return "skipped";
      const prefix =
        existing.length === 0 || existing.endsWith("\n")
          ? existing
          : `${existing}\n`;
      await writeInside(root, dest, `${prefix}${ENTRY}\n`);
      return "created";
    },
  );
}
