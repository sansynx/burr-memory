import { join } from "node:path";
import { assertInside, BurrFsError, readInside, writeInside } from "./fs.js";

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
  let data: Record<string, unknown>;

  try {
    const raw = await readInside(root, dest);
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "skipped";
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

  const plugins = Array.isArray(data.plugin) ? [...(data.plugin as string[])] : [];
  if (plugins.includes(plugin)) return "skipped";

  data.plugin = [...plugins, plugin];
  await writeInside(root, dest, `${JSON.stringify(data, null, 2)}\n`);
  return "created";
}
