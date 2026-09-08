import { evaluateCandidateAdmission } from "../learning/admission.js";
import {
  listAllMemories,
  mergeCandidate,
  promoteCandidate,
  saveCandidate,
  trimCandidates,
} from "../learning/consolidator.js";
import { reflectOnSession } from "../learning/reflection.js";
import {
  formatRetrievedMemoriesForContext,
  retrieveRelevantMemories,
} from "../learning/retrieval.js";
import { recordMetricsEvent } from "../metrics/tracker.js";
import { getSessionActions, recordAction } from "../runtime/action-ledger.js";
import {
  canonicalize,
  detectOutputStagnation,
  evaluateLoopRisk,
  fingerprintInput,
  fingerprintOutput,
} from "../runtime/loop-detector.js";
import { clip } from "../shared/bounds.js";
import { loadConfig } from "../shared/config.js";
import { userHome } from "../shared/home.js";
import { redact } from "../shared/redaction.js";
import type {
  CandidateLesson,
  LoopDetectionResult,
  MemoryItem,
  MemoryScope,
} from "../shared/types.js";

export interface CodexPreToolUseInput {
  sessionId: string;
  tool: string;
  args: unknown;
  turnId?: string;
  scope?: MemoryScope;
}

export interface CodexPreToolUseResult {
  allow: boolean;
  block?: boolean;
  warning?: string;
  message?: string;
  score?: number;
  reasons?: string[];
  suggestedAction?: string;
}

export interface CodexPostToolUseInput {
  sessionId: string;
  tool: string;
  args: unknown;
  output: unknown;
  error?: string;
  turnId?: string;
  durationMs?: number;
}

export interface CodexPostToolUseResult {
  success: boolean;
  stagnationDetected: boolean;
  outputFingerprint: string;
}

export interface CodexSessionStartInput {
  sessionId: string;
  taskDescription?: string;
  scope?: MemoryScope;
  root?: string;
}

export interface CodexSessionStartResult {
  sessionId: string;
  retrievedMemories: MemoryItem[];
  injectedPrompt: string;
}

export interface CodexSessionEndInput {
  sessionId: string;
  verified: boolean;
  verificationCommand?: string;
  verificationOutput?: string;
  taskDescription?: string;
  error?: string;
  rootCause?: string;
  fix?: string;
  scope?: MemoryScope;
  root?: string;
}

export interface CodexSessionEndResult {
  sessionId: string;
  verified: boolean;
  candidatesGenerated: number;
  memoriesPromoted: number;
  memoriesMerged: number;
  candidates: CandidateLesson[];
}

export async function handlePreToolUse(
  input: CodexPreToolUseInput,
  options: { home?: string; root?: string; harness?: string } = {},
): Promise<CodexPreToolUseResult> {
  const home = options.home ?? userHome();
  const root = options.root ?? process.cwd();
  const config = await loadConfig(root);

  if (config.mode === "off" || !config.runtime.enabled) {
    return { allow: true };
  }

  const normalizedArgs = canonicalize(input.args);
  const inputFp = fingerprintInput(input.tool, normalizedArgs);
  const recentActions = await getSessionActions(home, input.sessionId);

  const loopResult: LoopDetectionResult = evaluateLoopRisk(
    input.tool,
    normalizedArgs,
    recentActions,
    config.runtime,
  );

  const signals = {
    exactRepeat: loopResult.reasons.includes("exact-repeat"),
    fuzzyRepeat: loopResult.reasons.includes("fuzzy-repeat"),
    cycle: loopResult.reasons.includes("cycle"),
    stagnation: loopResult.reasons.includes("output-stagnation"),
  };

  if (loopResult.level === "block") {
    await recordAction(home, {
      sessionId: input.sessionId,
      harness: options.harness ?? "codex",
      tool: input.tool,
      normalizedArgs,
      inputFingerprint: inputFp,
      status: "blocked",
      signals,
      error: `Blocked by Burr Loop Guard: score ${loopResult.score} (${loopResult.reasons.join(", ")})`,
    });

    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "action_blocked",
        harness: options.harness ?? "codex",
        tool: input.tool,
        data: { score: loopResult.score, reasons: loopResult.reasons },
      },
      home,
    );

    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "loop_detected",
        harness: options.harness ?? "codex",
        tool: input.tool,
        data: { score: loopResult.score, reasons: loopResult.reasons },
      },
      home,
    );

    return {
      allow: false,
      block: true,
      score: loopResult.score,
      reasons: loopResult.reasons,
      message: `[Burr Loop Guard] Repetitive non-progress action blocked (score: ${loopResult.score}/100, reasons: ${loopResult.reasons.join(", ")}). You are stuck in a repetitive cycle with "${input.tool}". Change strategy or check targeted test output.`,
      suggestedAction:
        "Inspect recent error message, run a targeted test, or examine a different module.",
    };
  }

  if (loopResult.level === "warn") {
    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "loop_detected",
        harness: options.harness ?? "codex",
        tool: input.tool,
        data: { score: loopResult.score, reasons: loopResult.reasons },
      },
      home,
    );

    return {
      allow: true,
      warning: `[Burr Loop Guard Warning] Loop risk score: ${loopResult.score}/100 (${loopResult.reasons.join(", ")}). Consider verifying progress.`,
      score: loopResult.score,
      reasons: loopResult.reasons,
    };
  }

  return { allow: true };
}

export async function handlePostToolUse(
  input: CodexPostToolUseInput,
  options: { home?: string; root?: string; harness?: string } = {},
): Promise<CodexPostToolUseResult> {
  const home = options.home ?? userHome();
  const config = await loadConfig(options.root ?? process.cwd());
  if (config.mode === "off" || !config.runtime.enabled) {
    return { success: true, stagnationDetected: false, outputFingerprint: "" };
  }
  const normalizedArgs = canonicalize(input.args);
  const inputFp = fingerprintInput(input.tool, normalizedArgs);
  const outputFp = fingerprintOutput(input.output);
  const redactedSnippet = clip(
    redact(
      typeof input.output === "string"
        ? input.output
        : JSON.stringify(input.output),
    ),
    1000,
  );

  const recentActions = await getSessionActions(home, input.sessionId);
  const stagnation = detectOutputStagnation(recentActions);

  const status = input.error ? "failed" : "completed";

  await recordAction(home, {
    sessionId: input.sessionId,
    harness: options.harness ?? "codex",
    tool: input.tool,
    normalizedArgs,
    inputFingerprint: inputFp,
    outputFingerprint: outputFp,
    outputSnippet: redactedSnippet,
    status,
    durationMs: input.durationMs,
    signals: {
      stagnation: stagnation.detected,
    },
    error: input.error,
  });

  await recordMetricsEvent(
    {
      sessionId: input.sessionId,
      type: "tool_call",
      harness: options.harness ?? "codex",
      tool: input.tool,
      data: {
        status,
        durationMs: input.durationMs,
        stagnation: stagnation.detected,
      },
    },
    home,
  );

  return {
    success: true,
    stagnationDetected: stagnation.detected,
    outputFingerprint: outputFp,
  };
}

export async function handleSessionStart(
  input: CodexSessionStartInput,
  options: { home?: string; root?: string; harness?: string } = {},
): Promise<CodexSessionStartResult> {
  const home = options.home ?? userHome();
  const root = options.root ?? input.root ?? process.cwd();
  const config = await loadConfig(root);

  if (config.mode === "off") {
    return {
      sessionId: input.sessionId,
      retrievedMemories: [],
      injectedPrompt: "",
    };
  }

  await recordMetricsEvent(
    {
      sessionId: input.sessionId,
      type: "session_start",
      harness: options.harness ?? "codex",
      data: { taskDescription: input.taskDescription, scope: input.scope },
    },
    home,
  );

  const rawScope = input.scope as (MemoryScope & { repo?: string }) | undefined;
  const normalizedScope: MemoryScope | undefined = rawScope
    ? {
        level:
          rawScope.level ??
          (rawScope.repository || rawScope.repo ? "repository" : "global"),
        repository: rawScope.repository || rawScope.repo,
        language: rawScope.language,
        framework: rawScope.framework,
        package: rawScope.package,
        packageVersion: rawScope.packageVersion,
        tool: rawScope.tool,
      }
    : undefined;

  const retrieved = await retrieveRelevantMemories({
    scope: normalizedScope,
    taskDescription: input.taskDescription,
    limit: config.memory.maxRetrieved,
    home,
  });

  if (retrieved.length > 0) {
    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "hit",
        harness: options.harness ?? "codex",
        data: { count: retrieved.length },
      },
      home,
    );
  } else {
    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "miss",
        harness: options.harness ?? "codex",
      },
      home,
    );
  }

  const prompt = formatRetrievedMemoriesForContext(retrieved);

  return {
    sessionId: input.sessionId,
    retrievedMemories: retrieved.map((r) => r.item),
    injectedPrompt: prompt,
  };
}

export async function handleSessionEnd(
  input: CodexSessionEndInput,
  options: { home?: string; root?: string; harness?: string } = {},
): Promise<CodexSessionEndResult> {
  const home = options.home ?? userHome();
  const config = await loadConfig(options.root ?? input.root ?? process.cwd());
  if (config.mode === "off") {
    return {
      sessionId: input.sessionId,
      verified: input.verified,
      candidatesGenerated: 0,
      memoriesPromoted: 0,
      memoriesMerged: 0,
      candidates: [],
    };
  }

  await recordMetricsEvent(
    {
      sessionId: input.sessionId,
      type: "verification",
      harness: options.harness ?? "codex",
      data: { verified: input.verified, command: input.verificationCommand },
    },
    home,
  );

  await recordMetricsEvent(
    {
      sessionId: input.sessionId,
      type: "session_end",
      harness: options.harness ?? "codex",
      data: { verified: input.verified },
    },
    home,
  );

  if (!input.verified) {
    return {
      sessionId: input.sessionId,
      verified: false,
      candidatesGenerated: 0,
      memoriesPromoted: 0,
      memoriesMerged: 0,
      candidates: [],
    };
  }

  const rawEndScope = (input.scope ?? { level: "global" }) as MemoryScope & {
    repo?: string;
  };
  const defaultScope: MemoryScope = {
    level:
      rawEndScope.level ??
      (rawEndScope.repository || rawEndScope.repo ? "repository" : "global"),
    repository: rawEndScope.repository || rawEndScope.repo,
    language: rawEndScope.language,
    framework: rawEndScope.framework,
    package: rawEndScope.package,
    packageVersion: rawEndScope.packageVersion,
    tool: rawEndScope.tool,
  };

  const reflection = await reflectOnSession({
    sessionId: input.sessionId,
    scope: defaultScope,
    verified: input.verified,
    verificationCommand: input.verificationCommand,
    verificationOutput: input.verificationOutput,
    taskDescription: input.taskDescription,
    error: input.error,
    rootCause: input.rootCause,
    fix: input.fix,
    home,
  });

  let memoriesPromoted = 0;
  let memoriesMerged = 0;
  const existingMemories = await listAllMemories(home);

  for (const candidate of reflection.candidates) {
    await saveCandidate(candidate, home);
    await trimCandidates(home, config.memory.maxCandidates);
    await recordMetricsEvent(
      {
        sessionId: input.sessionId,
        type: "candidate_created",
        harness: options.harness ?? "codex",
        data: { candidateId: candidate.id, type: candidate.type },
      },
      home,
    );

    const admission = evaluateCandidateAdmission(candidate, existingMemories);

    if (admission.decision === "promote") {
      const promoted = await promoteCandidate(candidate, home);
      existingMemories.push(promoted);
      memoriesPromoted += 1;
      await recordMetricsEvent(
        {
          sessionId: input.sessionId,
          type: "memory_promoted",
          harness: options.harness ?? "codex",
          data: { memoryId: promoted.id, statement: promoted.statement },
        },
        home,
      );
    } else if (admission.decision === "merge" && admission.targetMemoryId) {
      await mergeCandidate(candidate, admission.targetMemoryId, home);
      memoriesMerged += 1;
      await recordMetricsEvent(
        {
          sessionId: input.sessionId,
          type: "memory_merged",
          harness: options.harness ?? "codex",
          data: {
            candidateId: candidate.id,
            targetMemoryId: admission.targetMemoryId,
          },
        },
        home,
      );
    } else {
      await recordMetricsEvent(
        {
          sessionId: input.sessionId,
          type: "candidate_discarded",
          harness: options.harness ?? "codex",
          data: { candidateId: candidate.id, reason: admission.reason },
        },
        home,
      );
    }
  }

  return {
    sessionId: input.sessionId,
    verified: true,
    candidatesGenerated: reflection.candidates.length,
    memoriesPromoted,
    memoriesMerged,
    candidates: reflection.candidates,
  };
}

export function handlePreCompact(_context: { systemPrompt?: string }): {
  preservedNotes: string;
} {
  return {
    preservedNotes:
      "Burr runtime guard and memory state active. Retain verified rules and tool strategies.",
  };
}

export function handlePostCompact(_event: { systemPrompt?: string }): {
  updatedPrompt?: string;
} {
  return {};
}
