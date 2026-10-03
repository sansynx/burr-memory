import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdir, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

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

async function assertNoSymlinkSegments(
  root: string,
  target: string,
): Promise<void> {
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

async function guardedPath(root: string, target: string): Promise<string> {
  const dest = assertInside(root, joinSafe(root, target));
  await assertNoSymlinkSegments(root, dest);
  return dest;
}

async function assertCanonicalParent(
  root: string,
  target: string,
): Promise<void> {
  const canonicalRoot = await realpath(root);
  const canonicalParent = await realpath(dirname(target));
  assertInside(canonicalRoot, resolve(canonicalParent, basename(target)));
}

async function assertUnlinkedFile(target: string) {
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new BurrFsError(`Refusing non-file path: ${target}`);
  }
  if (info.nlink > 1) {
    throw new BurrFsError(`Refusing hard link: ${target}`);
  }
  return info;
}

function isUnstablePathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === "ENOENT" ||
    code === "EPERM" ||
    code === "EACCES" ||
    code === "EBUSY"
  );
}

async function lstatAfterOpen(target: string) {
  try {
    return await lstat(target);
  } catch (error) {
    if (isUnstablePathError(error)) {
      throw new BurrFsError(`Refusing changed path during write: ${target}`);
    }
    throw error;
  }
}

async function assertOpenedFile(
  handle: FileHandle,
  target: string,
): Promise<void> {
  const opened = await handle.stat();
  const current = await lstatAfterOpen(target);
  if (
    !opened.isFile() ||
    !current.isFile() ||
    current.isSymbolicLink() ||
    opened.dev !== current.dev ||
    opened.ino !== current.ino
  ) {
    throw new BurrFsError(`Refusing changed path during write: ${target}`);
  }
  if (opened.nlink > 1 || current.nlink > 1) {
    throw new BurrFsError(`Refusing hard link: ${target}`);
  }
}

async function prepareInside(root: string, target: string): Promise<string> {
  const dest = await guardedPath(root, target);
  await ensureDirectoryInside(root, dirname(dest));
  await assertNoSymlinkSegments(root, dest);
  await assertCanonicalParent(root, dest);
  return dest;
}

export async function ensureDirectoryInside(
  root: string,
  target: string,
): Promise<void> {
  const dest = await guardedPath(root, target);
  try {
    const existing = await lstat(dest);
    if (!existing.isDirectory())
      throw new BurrFsError(`Refusing non-directory: ${dest}`);
    if (dest !== resolve(root)) await assertCanonicalParent(root, dest);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let current = resolve(root);
  for (const segment of relative(current, dest)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = resolve(current, segment);
    await assertNoSymlinkSegments(root, current);
    await assertCanonicalParent(root, current);
    try {
      await mkdir(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new BurrFsError(`Refusing symlink or non-directory: ${current}`);
  }
}

async function refuseUnstablePath(
  target: string,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof BurrFsError) throw error;
    if (isUnstablePathError(error)) {
      throw new BurrFsError(`Refusing changed path during write: ${target}`);
    }
    throw error;
  }
}

async function writeSafely(
  root: string,
  dest: string,
  flags: number,
  data: string,
): Promise<void> {
  const handle = await open(dest, flags | constants.O_NOFOLLOW, 0o600);
  try {
    await refuseUnstablePath(dest, async () => {
      await assertCanonicalParent(root, dest);
      await assertOpenedFile(handle, dest);
    });
    await handle.writeFile(data, "utf8");
  } finally {
    await handle.close();
  }
}

export async function writeIfMissing(
  root: string,
  target: string,
  data: string,
): Promise<"created" | "skipped"> {
  const dest = await prepareInside(root, target);
  try {
    await writeSafely(
      root,
      dest,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      data,
    );
    return "created";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return "skipped";
    throw error;
  }
}

export async function writeInside(
  root: string,
  target: string,
  data: string,
): Promise<string> {
  const dest = await prepareInside(root, target);
  const original = await open(
    dest,
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
    0o600,
  );
  const temporary = `${dest}.${randomUUID()}.tmp`;
  try {
    await refuseUnstablePath(dest, () => assertOpenedFile(original, dest));
    await writeSafely(
      root,
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      data,
    );
    const staged = await open(
      temporary,
      constants.O_RDWR | constants.O_NOFOLLOW,
    );
    try {
      await assertOpenedFile(staged, temporary);
      await staged.sync();
    } finally {
      await staged.close();
    }
    await assertNoSymlinkSegments(root, dest);
    await assertCanonicalParent(root, dest);
    await assertOpenedFile(original, dest);
    // Windows requires closing the destination handle before replacement.
    await original.close();
    await rename(temporary, dest);
  } finally {
    await original.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  return dest;
}

export async function appendInside(
  root: string,
  target: string,
  data: string,
): Promise<string> {
  const dest = await prepareInside(root, target);
  await writeSafely(
    root,
    dest,
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND,
    data,
  );
  return dest;
}

export async function readInside(
  root: string,
  target: string,
): Promise<string> {
  const dest = await guardedPath(root, target);
  await assertCanonicalParent(root, dest);
  const before = await assertUnlinkedFile(dest);
  const handle = await open(dest, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await assertCanonicalParent(root, dest);
    await assertOpenedFile(handle, dest);
    const text = await handle.readFile("utf8");
    const after = await lstat(dest);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.dev !== before.dev ||
      after.ino !== before.ino
    ) {
      throw new BurrFsError(`Refusing changed path during read: ${target}`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

export async function fileStampInside(
  root: string,
  target: string,
): Promise<string> {
  const dest = await guardedPath(root, target);
  await assertCanonicalParent(root, dest);
  const info = await assertUnlinkedFile(dest);
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}

export async function removeInside(
  root: string,
  target: string,
): Promise<void> {
  const dest = await guardedPath(root, target);
  await assertCanonicalParent(root, dest);
  const before = await assertUnlinkedFile(dest);
  await assertNoSymlinkSegments(root, dest);
  await assertCanonicalParent(root, dest);
  const after = await assertUnlinkedFile(dest);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new BurrFsError(`Refusing changed path during removal: ${target}`);
  }
  await unlink(dest);
}

export async function withInsideLock<T>(
  root: string,
  target: string,
  action: () => Promise<T>,
): Promise<T> {
  const dest = await prepareInside(root, target);
  const token = `${process.pid}:${randomUUID()}\n`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const handle = await open(
        dest,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(token, "utf8");
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      const errCode = (error as NodeJS.ErrnoException).code;
      const isLockContention =
        errCode === "EEXIST" ||
        (process.platform === "win32" &&
          (errCode === "EPERM" || errCode === "EBUSY" || errCode === "EACCES"));
      if (!isLockContention || attempt >= 500) throw error;
      let existing;
      try {
        existing = await lstat(dest);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        existing.nlink > 1
      ) {
        throw new BurrFsError(`Refusing lock at non-file path: ${target}`);
      }
      if (Date.now() - existing.mtimeMs > 30_000) {
        const owner = await readInside(root, dest).catch(() => "");
        const pid = Number(owner.split(":")[0]);
        let alive = false;
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            alive = true;
          } catch (error) {
            alive = (error as NodeJS.ErrnoException).code !== "ESRCH";
          }
        }
        if (!alive) {
          // Serialize stale-owner checks so a second reaper cannot remove a new lock.
          const recovery = `${dest}.recovery`;
          await withInsideLock(root, recovery, async () => {
            const current = await readInside(root, dest).catch(() => "");
            if (current === owner) {
              await removeInside(root, dest).catch(
                (error: NodeJS.ErrnoException) => {
                  if (error.code !== "ENOENT") throw error;
                },
              );
            }
          });
          continue;
        }
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }

  try {
    return await action();
  } finally {
    if ((await readInside(root, dest).catch(() => "")) === token) {
      await unlink(dest).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
}

function joinSafe(root: string, target: string): string {
  return isAbsolute(target) ? target : resolve(root, target);
}
