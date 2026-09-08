import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join } from "node:path";
import { loadConfig } from "../shared/config.js";
import { readInside, writeInside, withInsideLock } from "../shared/fs.js";
import { userHome } from "../shared/home.js";
import { userRunsDir } from "../shared/user-memory.js";
import {
  handlePostToolUse,
  handlePreToolUse,
  handleSessionEnd,
  handleSessionStart,
} from "./hooks.js";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Invalid Codex hook input");
  return value;
}

function toolError(response: unknown): string | undefined {
  const data = object(response);
  const exitCode = data.exit_code ?? data.exitCode;
  if (
    (typeof exitCode === "number" && exitCode !== 0) ||
    data.isError === true ||
    data.success === false
  ) {
    return typeof data.output === "string"
      ? data.output
      : "Tool execution failed";
  }
  // Some local tools expose the exit status in their model-facing text.
  if (
    typeof response === "string" &&
    /(?:Process exited with code|Exit code:)\s*[1-9]\d*/i.test(response)
  )
    return response;
  return undefined;
}

async function repositoryName(root: string): Promise<string> {
  try {
    const { stdout } = await promisify(execFile)(
      "git",
      ["-C", root, "config", "--get", "remote.origin.url"],
      { timeout: 1500, windowsHide: true },
    );
    const remote = stdout.trim();
    const path = remote.includes("://")
      ? new URL(remote).pathname
      : remote.match(/^[^/]+@[^:]+:(.+)$/)?.[1];
    if (path) return path.replace(/^\/+|\.git$/g, "");
  } catch {
    /* A project without a remote uses its directory name. */
  }
  return basename(root);
}

async function configuredRoot(cwd: string): Promise<string> {
  let candidate = cwd;
  for (;;) {
    try {
      await readInside(candidate, join(candidate, ".burr", "config.json"));
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return cwd;
    candidate = parent;
  }
}

export async function dispatchCodexHook(
  raw: unknown,
  options: { home?: string } = {},
): Promise<Record<string, unknown>> {
  const event = { ...object(raw) };
  const sessionId = requiredString(event.session_id);
  const cwd = requiredString(event.cwd);
  if (!isAbsolute(cwd)) throw new Error("Invalid Codex hook cwd");
  const root = await configuredRoot(cwd);
  event.cwd = root;
  const name = requiredString(event.hook_event_name);
  const config = await loadConfig(root);
  if (
    config.mode === "off" ||
    ((name === "PreToolUse" || name === "PostToolUse") &&
      !config.runtime.enabled)
  )
    return {};
  const toolEvent =
    typeof event.tool_use_id === "string" &&
    (name === "PreToolUse" || name === "PostToolUse");
  if (!toolEvent && name !== "SessionStart" && name !== "SessionEnd")
    return dispatch(event, options);
  const home = options.home ?? userHome();
  const sessionKey = createHash("sha256").update(sessionId).digest("hex");
  const eventKey = createHash("sha256")
    .update(
      `${name}:${toolEvent ? event.tool_use_id : (event.source ?? event.reason ?? "")}`,
    )
    .digest("hex");
  const path = join(userRunsDir(home), `${sessionKey}.hooks.json`);
  return withInsideLock(home, `${path}.lock`, async () => {
    let receipts: Array<{
      key: string;
      result: Record<string, unknown>;
      at?: number;
    }> = [];
    try {
      const data: unknown = JSON.parse(await readInside(home, path));
      if (Array.isArray(data))
        receipts = data
          .filter(
            (item) =>
              typeof item?.key === "string" &&
              item.result &&
              typeof item.result === "object",
          )
          .slice(-128);
    } catch (error) {
      if (
        !(error instanceof SyntaxError) &&
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw error;
    }
    // SessionStart has no event id; only coalesce concurrent source deliveries.
    const prior = receipts.find(
      (receipt) =>
        receipt.key === eventKey &&
        (name !== "SessionStart" || Date.now() - (receipt.at ?? 0) < 5000),
    );
    if (prior) return prior.result;
    const result = await dispatch(event, options);
    receipts = receipts.filter((receipt) => receipt.key !== eventKey);
    receipts.push({
      key: eventKey,
      result: toolEvent ? result : {},
      at: Date.now(),
    });
    await writeInside(home, path, `${JSON.stringify(receipts.slice(-128))}\n`);
    return result;
  });
}

async function dispatch(
  raw: unknown,
  options: { home?: string },
): Promise<Record<string, unknown>> {
  const event = object(raw);
  const sessionId = requiredString(event.session_id);
  const root = requiredString(event.cwd);
  if (!isAbsolute(root)) throw new Error("Invalid Codex hook cwd");
  const hookEventName = requiredString(event.hook_event_name);
  const context = { ...options, root, harness: "codex" };

  if (hookEventName === "SessionStart") {
    const result = await handleSessionStart(
      {
        sessionId,
        root,
        scope: { level: "repository", repository: await repositoryName(root) },
      },
      context,
    );
    return result.injectedPrompt
      ? {
          hookSpecificOutput: {
            hookEventName,
            additionalContext: result.injectedPrompt,
          },
        }
      : {};
  }
  if (hookEventName === "SessionEnd") {
    // Closing a session is not verification evidence.
    await handleSessionEnd({ sessionId, root, verified: false }, context);
    return {};
  }
  if (hookEventName !== "PreToolUse" && hookEventName !== "PostToolUse")
    return {};
  const tool = requiredString(event.tool_name);
  if (!("tool_input" in event)) throw new Error("Missing Codex tool input");
  const input = {
    sessionId,
    tool,
    args: event.tool_input,
    turnId: typeof event.turn_id === "string" ? event.turn_id : undefined,
  };
  if (hookEventName === "PreToolUse") {
    const result = await handlePreToolUse(input, context);
    if (!result.allow)
      return {
        hookSpecificOutput: {
          hookEventName,
          permissionDecision: "deny",
          permissionDecisionReason:
            result.message ?? "Burr detected a repeated failure loop.",
        },
      };
    // Do not return permissionDecision: allow: normal host approvals still apply.
    return result.warning
      ? {
          hookSpecificOutput: {
            hookEventName,
            additionalContext: result.warning,
          },
        }
      : {};
  }
  const output = event.tool_response ?? "";
  await handlePostToolUse(
    { ...input, output, error: toolError(output) },
    context,
  );
  return {};
}
