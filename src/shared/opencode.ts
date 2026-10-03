import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  assertInside,
  BurrFsError,
  readInside,
  writeInside,
  withInsideLock,
} from "./fs.js";

export function isLegacyOpenCodePlugin(content: string): boolean {
  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/^const RUNTIME_URL = .*;\n/m, "");
  return (
    createHash("sha256").update(normalized).digest("hex") ===
    "3cce9efcfcfd422b9d1073a062873d7d342db928475ce133a4eda1f56bfd795c"
  );
}

export async function mergeOpenCodePlugin(
  root: string,
  file: string,
  plugin: string,
): Promise<"created" | "skipped"> {
  let dest: string;
  try {
    dest = assertInside(root, join(root, file));
  } catch (error) {
    if (error instanceof BurrFsError) return "skipped";
    throw error;
  }
  return withInsideLock(root, `${dest}.lock`, async () => {
    let data: Record<string, unknown>;

    try {
      const raw = await readInside(root, dest);
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return "skipped";
      data = parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        data = {};
      } else if (error instanceof SyntaxError || error instanceof BurrFsError) {
        return "skipped";
      } else {
        throw error;
      }
    }

    if (data.plugin !== undefined && !Array.isArray(data.plugin))
      return "skipped";
    const plugins = Array.isArray(data.plugin) ? [...data.plugin] : [];
    let repaired = false;
    // Repair the exact path emitted by older Burr versions in the nested config.
    if (
      file.replaceAll("\\", "/") === ".opencode/opencode.json" &&
      plugin === "./plugins/burr.mjs"
    ) {
      const old = plugins.indexOf("./.opencode/plugins/burr.mjs");
      if (old !== -1) {
        plugins.splice(old, 1);
        repaired = true;
      }
    }
    if (plugins.includes(plugin) && !repaired) return "skipped";

    data.plugin = plugins.includes(plugin) ? plugins : [...plugins, plugin];
    await writeInside(root, dest, `${JSON.stringify(data, null, 2)}\n`);
    return "created";
  });
}
