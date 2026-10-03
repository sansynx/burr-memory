export type Mode = "on" | "strict" | "off";

export type Verb =
  "search" | "hit" | "miss" | "capture" | "resolve" | "promote" | "discard";
export type MemorySource = "project" | "global";

export interface UsageEvent {
  ts: string;
  verb: Verb;
  signature?: string;
  path?: string;
  reason?: string;
}

export interface CaptureInput {
  error: string;
  stack?: string;
  command?: string;
  exitCode?: number | string;
  attemptedFixes?: string[];
  whyKeep?: string;
  rootCause?: string;
}

export interface ResolveInput {
  error: string;
  rootCause: string;
  fix: string;
  failedAttempts?: string[];
  verification: string;
  context?: {
    language?: string;
    framework?: string;
    risk?: string;
    confidence?: string;
  };
}

export interface SearchHit {
  path: string;
  score: number;
  excerpt: string;
  source: MemorySource;
}

export interface Admission {
  ok: boolean;
  reason?: string;
}

export interface UsageSummary {
  counts: Record<Verb, number>;
  lastHits: UsageEvent[];
  lastDiscards: UsageEvent[];
}

export type ActionStatus = "started" | "completed" | "failed" | "blocked";

export interface ActionSignals {
  exactRepeat?: boolean;
  fuzzyRepeat?: boolean;
  cycle?: boolean;
  stagnation?: boolean;
}

export interface BurrAction {
  sessionId: string;
  sequence: number;
  timestamp: string;
  harness: string;
  tool: string;
  normalizedArgs: unknown;
  inputFingerprint: string;
  outputFingerprint?: string;
  outputSnippet?: string;
  status: ActionStatus;
  durationMs?: number;
  progressDelta?: number;
  signals?: ActionSignals;
  error?: string;
}

export type LoopRiskLevel = "record" | "warn" | "block";

export interface LoopDetectionResult {
  score: number;
  level: LoopRiskLevel;
  reasons: string[];
  details?: {
    repeatCount?: number;
    fuzzySimilarity?: number;
    cyclePattern?: string[];
    cycleLength?: number;
    stagnantOutputsCount?: number;
  };
}

export type MemoryScopeLevel =
  "global" | "ecosystem" | "repository" | "tool" | "package" | "framework";

export interface MemoryScope {
  level: MemoryScopeLevel;
  repository?: string;
  language?: string;
  framework?: string;
  package?: string;
  packageVersion?: string;
  tool?: string;
}

export type CandidateType =
  "repository-rule" | "tool-strategy" | "avoid" | "playbook";

export interface CandidateEvidence {
  sessionId: string;
  observedCount: number;
  toolCalls?: string[];
  verificationCommand?: string;
  verified?: boolean;
}

export interface CandidateLesson {
  id: string;
  type: CandidateType;
  statement: string;
  playbook?: {
    problem: string;
    rootCause: string;
    fix: string;
    verification?: { command?: string; result?: string };
  };
  scope: MemoryScope;
  evidence: CandidateEvidence;
  confidence: number;
  createdAt: string;
  status: "candidate" | "admitted" | "rejected" | "merged";
  rejectionReason?: string;
}

export type MemoryStatus = "active" | "stale" | "archived";

export interface MemoryItem {
  id: string;
  title: string;
  type: "playbook" | "knowledge" | "tool-strategy";
  scope: MemoryScope;
  statement?: string;
  problem?: string;
  errorSignature?: string;
  context?: {
    discoveredRules?: string[];
    language?: string;
    framework?: string;
  };
  loop?: {
    type?: string;
    score?: number;
    pattern?: string;
  };
  failedPaths?: string[];
  toolStrategy?: {
    useful?: string[];
    wasteful?: string[];
  };
  rootCause?: string;
  escapeStrategy?: string;
  fix?: string;
  verification?: {
    command?: string;
    result?: string;
  };
  evidence: {
    observed: number;
    successfulReuse: number;
    failedReuse: number;
    lastUsed?: string;
    sessionIds?: string[];
  };
  confidence: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  markdown?: string;
}

export interface RuntimeConfig {
  enabled: boolean;
  warnScore: number;
  blockScore: number;
  fuzzyThreshold: number;
  recentWindow: number;
}

export interface MemoryConfig {
  maxRetrieved: number;
  runRetentionDays: number;
  maxCandidates: number;
  archiveAfterDays: number;
}

export interface BurrConfig {
  mode: Mode;
  runtime: RuntimeConfig;
  memory: MemoryConfig;
}

export interface BurrHarnessCapabilities {
  name: string;
  beforeToolObservation: boolean;
  afterToolObservation: boolean;
  blocking: boolean;
  contextInjection: boolean;
}

export type MetricsEventType =
  | "session_start"
  | "session_end"
  | "tool_call"
  | "loop_detected"
  | "action_blocked"
  | "search"
  | "hit"
  | "miss"
  | "candidate_created"
  | "candidate_admitted"
  | "candidate_discarded"
  | "memory_merged"
  | "memory_promoted"
  | "memory_archived"
  | "memory_reused"
  | "verification";

export interface MetricsEvent {
  ts: string;
  sessionId: string;
  type: MetricsEventType;
  harness?: string;
  tool?: string;
  data?: Record<string, unknown>;
}

export interface RunSummary {
  sessionId: string;
  harness: string;
  startTime: string;
  endTime?: string;
  durationMs: number;
  toolCalls: number;
  failedCalls: number;
  blockedCalls: number;
  repeatedActions: number;
  loopsDetected: number;
  memorySearches: number;
  memoryHits: number;
  verified: boolean;
  candidatesGenerated: number;
  actions: BurrAction[];
}

export interface BurrStats {
  memory: {
    active: number;
    candidates: number;
    archived: number;
    hitRate: number;
    searches: number;
    hits: number;
    misses: number;
  };
  learning: {
    reusedTotal: number;
    successfulReuse: number;
    failedReuse: number;
    merged: number;
    promoted: number;
    discarded: number;
  };
  runtime: {
    observedSessions: number;
    observedCalls: number;
    loopsDetected: {
      total: number;
      exact: number;
      fuzzy: number;
      cycles: number;
      stagnation: number;
    };
    actionsBlocked: number;
    verifiedRecoveries: number;
  };
}
