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
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as {
          name?: string;
          bin?: string | Record<string, string>;
        };
        const bin = parsed.bin;
        const hasBurrBin =
          bin === "dist/cli/index.js" ||
          (typeof bin === "object" && bin !== null && "burr" in bin);
        if (hasBurrBin || parsed.name === "burr" || parsed.name === "burr-memory") {
          return dir;
        }
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
