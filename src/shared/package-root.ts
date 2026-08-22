import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function findPackageRoot(
  start = dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = start;
  for (let i = 0; i < 10; i += 1) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const name = JSON.parse(readFileSync(pkg, "utf8")).name;
        if (name === "burr") return dir;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Unable to locate the burr package root.");
}
