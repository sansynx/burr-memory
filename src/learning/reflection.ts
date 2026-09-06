import { createHash } from "node:crypto";
import { getSessionActions } from "../runtime/action-ledger.js";
import { clip } from "../shared/bounds.js";
import { redact } from "../shared/redaction.js";
import type { CandidateLesson, CandidateType, MemoryScope } from "../shared/types.js";

export interface ReflectionInput {
  sessionId: string;
  scope: MemoryScope;
  verified: boolean;
  verificationCommand?: string;
  verificationOutput?: string;
  taskDescription?: string;
  error?: string;
  rootCause?: string;
  fix?: string;
  home?: string;
}

export interface ReflectionResult {
  sessionId: string;
  verified: boolean;
  usefulTools: string[];
  wastefulTools: string[];
  successfulSequence: string[];
  avoidPaths: string[];
  candidates: CandidateLesson[];
}

function candidateId(type: CandidateType, statement: string, scope: MemoryScope): string {
  const hash = createHash("sha256")
    .update(`${type}:${scope.repository || scope.level}:${statement.trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
  return `cand-${hash}`;
}

export async function reflectOnSession(input: ReflectionInput): Promise<ReflectionResult> {
  const actions = await getSessionActions(input.home, input.sessionId);

  const toolSuccessCounts = new Map<string, number>();
  const toolFailCounts = new Map<string, number>();
  const toolLoopCounts = new Map<string, number>();
  const filesTouched = new Set<string>();
  const filesLooped = new Set<string>();

  for (const a of actions) {
    const tool = a.tool.trim();
    if (a.status === "completed") {
      toolSuccessCounts.set(tool, (toolSuccessCounts.get(tool) ?? 0) + 1);
    } else if (a.status === "failed" || a.status === "blocked") {
      toolFailCounts.set(tool, (toolFailCounts.get(tool) ?? 0) + 1);
    }

    if (a.signals?.exactRepeat || a.signals?.fuzzyRepeat || a.signals?.cycle || a.signals?.stagnation) {
      toolLoopCounts.set(tool, (toolLoopCounts.get(tool) ?? 0) + 1);
    }

    // Extract file paths from args if present
    if (a.normalizedArgs && typeof a.normalizedArgs === "object") {
      const args = a.normalizedArgs as Record<string, unknown>;
      const pathCandidate = args.path || args.file || args.filepath || args.target;
      if (typeof pathCandidate === "string" && pathCandidate.includes("/")) {
        const cleaned = pathCandidate.trim();
        if (a.signals?.exactRepeat || a.signals?.cycle) {
          filesLooped.add(cleaned);
        } else if (a.status === "completed") {
          filesTouched.add(cleaned);
        }
      }
    }
  }

  const usefulTools: string[] = [];
  const wastefulTools: string[] = [];

  for (const [tool, count] of toolSuccessCounts.entries()) {
    const loops = toolLoopCounts.get(tool) ?? 0;
    if (count >= 1 && loops === 0) {
      usefulTools.push(tool);
    } else if (loops > count) {
      wastefulTools.push(tool);
    }
  }

  for (const [tool, loops] of toolLoopCounts.entries()) {
    if (loops >= 2 && !wastefulTools.includes(tool)) {
      wastefulTools.push(tool);
    }
  }

  // Find the successful sequence: the last 3-5 completed non-looping actions
  const nonLooping = actions.filter(
    (a) => a.status === "completed" && !a.signals?.exactRepeat && !a.signals?.cycle,
  );
  const successfulSequence = nonLooping.slice(-5).map((a) => a.tool);

  const avoidPaths = Array.from(filesLooped);
  const candidates: CandidateLesson[] = [];
  const now = new Date().toISOString();

  // If the run was verified, generate reusable candidate lessons
  if (input.verified) {
    // 1. Tool strategy candidate
    if (usefulTools.length > 0) {
      const toolList = usefulTools.slice(0, 4).join(" -> ");
      const stmt = wastefulTools.length > 0
        ? `Use [${toolList}] for tasks; avoid repetitive [${wastefulTools.slice(0, 3).join(", ")}].`
        : `Effective tool sequence: [${toolList}].`;

      candidates.push({
        id: candidateId("tool-strategy", stmt, input.scope),
        type: "tool-strategy",
        statement: redact(stmt),
        scope: input.scope,
        evidence: {
          sessionId: input.sessionId,
          observedCount: actions.length,
          toolCalls: usefulTools,
          verificationCommand: input.verificationCommand,
          verified: true,
        },
        confidence: 0.75,
        createdAt: now,
        status: "candidate",
      });
    }

    // 2. Repository rules candidate from key files touched
    if (filesTouched.size > 0) {
      const topFiles = Array.from(filesTouched).slice(0, 3);
      const stmt = `Key modules for ${input.taskDescription ? clip(input.taskDescription, 60) : "verified tasks"}: ${topFiles.join(", ")}.`;

      candidates.push({
        id: candidateId("repository-rule", stmt, input.scope),
        type: "repository-rule",
        statement: redact(stmt),
        scope: input.scope,
        evidence: {
          sessionId: input.sessionId,
          observedCount: filesTouched.size,
          verificationCommand: input.verificationCommand,
          verified: true,
        },
        confidence: 0.8,
        createdAt: now,
        status: "candidate",
      });
    }

    // 3. Avoid candidate if there were significant loops or blocked actions
    if (avoidPaths.length > 0 || wastefulTools.length > 0) {
      const avoidStmt = avoidPaths.length > 0
        ? `Avoid repeated exploration of ${avoidPaths.slice(0, 3).join(", ")}; check targeted test output first.`
        : `Avoid repetitive ${wastefulTools.slice(0, 3).join(", ")} calls when progress stalls.`;

      candidates.push({
        id: candidateId("avoid", avoidStmt, input.scope),
        type: "avoid",
        statement: redact(avoidStmt),
        scope: input.scope,
        evidence: {
          sessionId: input.sessionId,
          observedCount: toolLoopCounts.size,
          verificationCommand: input.verificationCommand,
          verified: true,
        },
        confidence: 0.7,
        createdAt: now,
        status: "candidate",
      });
    }

    // 4. Playbook candidate if error/cause/fix provided
    if (input.error && input.rootCause && input.fix) {
      const stmt = `Fix for "${clip(input.error, 80)}": ${clip(input.fix, 120)}`;
      candidates.push({
        id: candidateId("playbook", stmt, input.scope),
        type: "playbook",
        statement: redact(stmt),
        scope: input.scope,
        evidence: {
          sessionId: input.sessionId,
          observedCount: 1,
          verificationCommand: input.verificationCommand,
          verified: true,
        },
        confidence: 0.85,
        createdAt: now,
        status: "candidate",
      });
    }
  }

  return {
    sessionId: input.sessionId,
    verified: input.verified,
    usefulTools,
    wastefulTools,
    successfulSequence,
    avoidPaths,
    candidates,
  };
}
