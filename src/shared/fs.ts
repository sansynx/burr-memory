import { mkdir, lstat, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class BurrFsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BurrFsError";
  }
}

export async function resolveProjectRoot(cwd: string): Promise<string> {
  const abs = resolve(cwd);
  const stat = await lstat(abs);
  if (stat.isSymbolicLink()) {
    throw new BurrFsError("Refusing symlink project root");
  }
  return realpath(abs);
}

export function assertInside(root: string, target: string): string {
  const resolved = resolve(target);
  const rel = relative(root, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new BurrFsError(`Refusing write outside the project root: ${target}`);
  }
  return resolved;
}

async function assertNoSymlinkSegments(root: string, target: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const rel = relative(resolvedRoot, target);
  let current = resolvedRoot;

  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new BurrFsError(`Refusing write through symlink: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function writeIfMissing(
  root: string,
  target: string,
  data: string,
): Promise<"created" | "skipped"> {
  const dest = assertInside(root, target);
  await assertNoSymlinkSegments(root, dest);
  await mkdir(dirname(dest), { recursive: true });
  try {
    await writeFile(dest, data, { flag: "wx" });
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "skipped";
    throw error;
  }
}

export async function writeInside(root: string, target: string, data: string): Promise<string> {
  const dest = assertInside(root, joinSafe(root, target));
  await assertNoSymlinkSegments(root, dest);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, data);
  return dest;
}

function joinSafe(root: string, target: string): string {
  return isAbsolute(target) ? target : resolve(root, target);
}
