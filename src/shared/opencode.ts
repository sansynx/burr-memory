import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeInside } from "./fs.js";

export async function mergeOpenCodePlugin(
  root: string,
  file: string,
  plugin: string,
): Promise<"created" | "skipped"> {
  const dest = join(root, file);
  let data: Record<string, unknown>;

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

  const plugins = Array.isArray(data.plugin) ? [...(data.plugin as string[])] : [];
  if (plugins.includes(plugin)) return "skipped";

  data.plugin = [...plugins, plugin];
  await writeInside(root, dest, `${JSON.stringify(data, null, 2)}\n`);
  return "created";
}
