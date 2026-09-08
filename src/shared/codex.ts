import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BurrFsError, readInside, writeInside, withInsideLock } from "./fs.js";

export const CODEX_EVENTS = [
  "SessionStart",
  "PreToolUse",
  "PostToolUse",
  "SessionEnd",
] as const;

export function codexHookCommand(packageRoot: string): string {
  // Encoding keeps shell metacharacters in an installation path inert on every host OS.
  const url = Buffer.from(
    pathToFileURL(join(packageRoot, "dist", "codex", "command.js")).href,
  ).toString("base64");
  return `node --input-type=module -e "await import(Buffer.from('${url}','base64').toString())"`;
}

export async function mergeCodexHooks(
  root: string,
  file: string,
  command: string,
): Promise<"created" | "skipped"> {
  const dest = join(root, file);
  return withInsideLock(root, `${dest}.lock`, async () => {
    let data: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(await readInside(root, dest));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return "skipped";
      data = parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof BurrFsError)
        return "skipped";
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      data.hooks !== undefined &&
      (!data.hooks ||
        typeof data.hooks !== "object" ||
        Array.isArray(data.hooks))
    )
      return "skipped";
    const hooks = { ...((data.hooks as Record<string, unknown>) ?? {}) };
    if (
      CODEX_EVENTS.some(
        (event) => hooks[event] !== undefined && !Array.isArray(hooks[event]),
      )
    )
      return "skipped";
    let changed = false;
    for (const event of CODEX_EVENTS) {
      const groups = (hooks[event] ?? []) as Array<{
        hooks?: Array<{ command?: string }>;
      }>;
      if (
        groups.some(
          (group) =>
            Array.isArray(group?.hooks) &&
            group.hooks.some((handler) => handler?.command === command),
        )
      )
        continue;
      hooks[event] = [
        ...groups,
        {
          hooks: [
            {
              type: "command",
              command,
              timeout: event === "SessionEnd" ? 3 : 10,
              statusMessage: "Burr local memory",
            },
          ],
        },
      ];
      changed = true;
    }
    if (!changed) return "skipped";
    await writeInside(
      root,
      dest,
      `${JSON.stringify({ ...data, hooks }, null, 2)}\n`,
    );
    return "created";
  });
}
