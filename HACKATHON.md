# Burr — Hackathon Submission

> **Syndicate by Maximor**  
> **Track:** Automated Agent Engineering  
> **Product:** Burr  
> **Tagline:** Agents that remember how they got unstuck.  
> **Repository:** [https://github.com/sansynx/burr-memory](https://github.com/sansynx/burr-memory)  
> **Devpost:** [https://syndicate-by-maximor.devpost.com/](https://syndicate-by-maximor.devpost.com/)  
> **AO (Agent Orchestrator):** [https://aoagents.dev/](https://aoagents.dev/) | [AO GitHub](https://github.com/Untrivial-ai/agent-orchestrator)  

---

## Executive Summary

Autonomous coding agents routinely fail in two distinct ways:
1. **Current-session looping:** When an approach fails, agents repeatedly retry minor variations of failing commands, grep in circles, or emit stagnant outputs without recognizing that they are stuck.
2. **Cross-session amnesia:** Once a session ends or context is compacted, hard-won insights vanish. A fresh agent starting on the same repository repeats identical exploration mistakes and crashes into the same pitfalls.

**Burr** solves both problems as a **local learning and reliability runtime for coding agents**, featuring **OpenAI Codex** as a first-class integration and **AO (Agent Orchestrator)** as the orchestration harness.

Burr operates on a strict rule: **One agent learns something once. The next agent must not repeat the same debugging or tool-usage mistakes.**

```text
TASK
 │
 v
Codex starts working (AO Session)
 │
 v
Search Burr local memory (top-k scoped match)
 │
 v
Perform tool calls
 │
 v
Burr runtime ledger records action & checks loop risk
 │
 ├── Loop risk >= 50? ──► Emit warning & suggest redirection
 └── Loop risk >= 70? ──► Block action & force alternate path
 │
 v
Task completed & verified?
 │
 ├── Unverified / Failed ─► Ephemeral run logged; no memory promoted
 └── Verified (Test passed)
      │
      v
   Self-reflection (tool effectiveness & successful sequence)
      │
      v
   Candidate admission (noise filtering, duplicate deduplication)
      │
      v
   Consolidation (promote / merge into bounded memory)
      │
      v
Next fresh Codex session inherits proven playbooks & strategies!
```

---

## System Architecture

```text
                              AO
                 Agent Orchestrator Harness
                             │
                             v
                     OPENAI CODEX
                             │
              tools / APIs / MCP / shell
                             │
                             v
              ┌─────────────────────────────┐
              │            BURR             │
              │                             │
              │  Runtime Watcher            │
              │  Action Ledger (JSONL)      │
              │  Deterministic Loop Guard   │
              │  Self-Reflection Engine     │
              │  Candidate Admission Gate   │
              │  Memory Consolidator        │
              │  Top-K Scoped Retrieval     │
              └──────────────┬──────────────┘
                             │
                             v
                     ~/.burr/ (Local Only)
              ┌──────────────┴──────────────┐
              │                             │
        Active Memories              Ephemeral Runs
      (knowledge, playbooks,         (bounded TTL,
       strategies, avoidances)        action ledgers)
```

Burr runs **100% locally with 0 runtime dependencies**. No cloud databases, no remote telemetry, no external embedding APIs, and no mandatory model keys are required for the core loop guard and retrieval engines.

---

## OpenAI Codex Runtime Hooks

Burr hooks directly into OpenAI Codex lifecycle events (`src/codex/hooks.ts`):

- **`PreToolUse`**: Evaluates proposed tool execution against recent action history. Calculates composite loop risk score. If `score >= 70`, blocks execution with structured advice. If `score >= 50`, returns warning advice.
- **`PostToolUse`**: Hashes output fingerprints, detects output stagnation, records execution duration and status in the session ledger.
- **`SessionStart`**: Automatically retrieves top-k relevant memories matching the repository, language, and task tokens, injecting high-confidence guidance into the agent prompt.
- **`SessionEnd`**: If verified, triggers post-task self-reflection, scores tool utility, generates candidate lessons, and consolidates them into shared memory.
- **`PreCompact` / `PostCompact`**: Safeguards active session state and learned lessons across context compaction boundaries.

---

## Deterministic Runtime Loop Detection

Rather than relying on another expensive and hallucination-prone LLM call, Burr uses four deterministic mathematical detectors:

1. **Exact Repetition (+40 risk):** Normalized string matching on tool name and canonicalized arguments (`SHA-256` payload hashing).
2. **Fuzzy Repetition (+25 risk):** Tokenized Jaccard similarity thresholded at `0.85`. Catches minor typographical variations and repeated queries.
3. **Cycle Detection (+30 risk):** Subsequence matching for repeating action loops of lengths $k \in [2, 6]$ (e.g. `grep -> test -> grep -> test`).
4. **Output Stagnation (+20 risk):** Consecutive identical output hashes or error output hashes indicating zero forward progress.
5. **Repeated Failure Penalty (+10 risk):** Consecutive failing commands.

### Thresholds:
- **Risk < 50:** Normal recording.
- **Risk 50–69:** **Warn.** Injects actionable redirection guidance.
- **Risk >= 70:** **Block.** Execution is blocked, forcing the agent to select a different strategy.

---

## Bounded Memory Lifecycle & Anti-Bloat Architecture

Burr does not allow unbounded memory accumulation:

```text
~/.burr/
  runs/              Ephemeral session action ledgers (TTL 3–7 days; automatically pruned)
  candidates/        Unverified lesson proposals (capacity bounded to 100)
  memory/
    knowledge/       Repository facts, module mappings, package conventions
    tool-strategies/ Proven effective tool combinations
    avoid/           Anti-patterns and disallowed commands
    playbooks/       Verified problem-cause-fix-verification records
  archive/           Stale and demoted memories (capacity bounded)
  metrics/           Performance and learning progression events
```

### Memory Quality & Decay Rules:
- **Admission Filter:** Ephemeral noise (port conflicts, missing local build artifacts, dev-server timeouts) is discarded immediately.
- **Deduplication:** Near-duplicate candidate lessons are merged into existing records, boosting observation count rather than bloating storage.
- **Confidence Scoring:** Memories start at base confidence ($0.70$–$0.85$). Successful reuse boosts confidence by $+0.05$. Failed reuse penalizes confidence by $-0.15$.
- **Decay & Pruning:** Memories unused for 30 days degrade to `stale` (receiving a retrieval penalty). After 60 days of inactivity, they are moved to `archive/`. Old runs are purged after TTL.

---

## Multi-Session Benchmark: Progression Over Time

The core evaluation for the **Automated Agent Engineering** track demonstrates how an agent improves over successive unseen tasks orchestrated via **AO (Agent Orchestrator)**.

### Test Environment
- **Repository:** `sansynx/burr-memory`
- **Orchestrator:** AO (`aoagents.dev`)
- **Agent Integration:** OpenAI Codex runtime hooks
- **Harness:** Automated deterministic multi-session benchmark runner (`test/benchmark.test.ts`)

### Benchmark Execution Trace

#### AO Session 1: `ao-sess-task1-monorepo-resolver`
- **Task:** Fix ESM module resolution failure in `@repo/utils` packages.
- **Starting Memory:** Empty (Cold Start).
- **Execution:**
  1. Agent explores broadly: `find_by_name`, `grep_search` across multiple directories.
  2. Agent repeats failing `npm test` and broad `grep` commands (turns 4–6).
  3. **Burr Loop Guard triggers on turn 7:** Cycle and repetition detected (Score: 70). Action blocked with advice: *"Action blocked: repeating cycle detected. Pivot strategy: inspect configuration files or build artifacts directly."*
  4. Agent redirects: reads `package.json`, discovers missing build step, runs `npm run build`, then runs targeted test `npm test -- test/resolver.test.ts`.
  5. Verification passes: 4 tests green.
  6. **Reflection & Promotion:** Burr reflects on session, extracts 2 candidate lessons:
     - `repository-rule`: *Always execute npm run build before testing TypeScript packages with package exports*
     - `tool-strategy`: *Prefer targeted test flags over global runs*
     Candidates pass admission and are promoted to active memory.

#### AO Session 2: `ao-sess-task2-circular-dep`
- **Task:** Fix module circular dependency in CLI build and run tests.
- **Starting Memory:** Contains 2 memories from Session 1.
- **Execution:**
  1. `handleSessionStart` retrieves the repository build rule and injects it into context.
  2. Codex skips exploratory searches entirely.
  3. Targets `src/cli/index.ts` immediately, applies fix, builds with `npm run build`, and verifies with `npm test -- test/cli.test.ts`.
  4. Tool calls drop by **60%** (from 10 to 4). Zero loops encountered.

#### AO Session 3: `ao-sess-task3-path-containment`
- **Task:** Ensure safe fs path containment guards against symlink directory escape.
- **Execution:**
  1. Retrieves tool strategies and repository build conventions.
  2. Executes targeted edit in `src/shared/fs.ts`, builds, and runs isolated tests.
  3. Completed in **3 tool calls**. Verification passes on first attempt. Memory confidence increases.

#### AO Session 4: `ao-sess-task4-doctor-integrity`
- **Task:** Add doctor CLI check for storage directory health.
- **Execution:**
  1. High-confidence mature memory active.
  2. Executes direct build and targeted doctor test in **2 tool calls**.
  3. Completed rapidly with 0 failed calls and 0 loops.

---

### Quantitative Comparison Table

| Metric | Run 1 (Cold Start) | Run 2 (Learned Rule) | Run 3 (Reused Strategy) | Run 4 (Mature Memory) | Net Improvement |
|:---|:---:|:---:|:---:|:---:|:---:|
| **Session ID** | `ao-sess-task1` | `ao-sess-task2` | `ao-sess-task3` | `ao-sess-task4` | — |
| **Total Tool Calls** | **10** | **4** | **3** | **2** | **-80.0%** |
| **Failed / Wasted Calls** | **3** | **0** | **0** | **0** | **-100%** |
| **Loops Detected** | **2** | **0** | **0** | **0** | **-100%** |
| **Memory Hits** | **0** (cold) | **1** | **1** | **1** | **75% Hit Rate** |
| **Execution Duration** | **194 ms** | **67 ms** | **37 ms** | **18 ms** | **-90.7%** |
| **Task Verification** | Verified (✓) | Verified (✓) | Verified (✓) | Verified (✓) | **100% Success** |

---

## Memory Bounding & Capacity Proof

At the end of the 4-task progression benchmark:
- **Total active memories stored:** `5` (strictly bounded).
- **Candidates remaining:** `0` (all unverified or noisy proposals rejected).
- **Disk footprint:** Less than `12 KB`.
- **Search latency:** `< 2 ms` (local token overlap & scope filtering).

Memory does not grow linearly with tasks; it grows asymptotically toward repository mastery, then stabilizes.

---

## CLI Tooling & Local Dashboard

Burr ships with a comprehensive set of diagnostic and inspection commands:

```bash
# View aggregated learning and reliability metrics
burr stats

# Side-by-side run comparison
burr compare ao-sess-task1-monorepo-resolver ao-sess-task2-circular-dep

# Manage local memory items
burr memory summary
burr memory list --type knowledge
burr memory inspect mem-xxxx
burr memory prune

# Health checks for storage and Codex hook configuration
burr doctor

# Launch the local visual dashboard (zero cloud dependencies)
burr dashboard --port 4747
```

### Visual Identity
The dashboard runs at `http://127.0.0.1:4747` using Burr's bespoke aesthetic:
- **Ink:** `#0F0F0E` (deep workspace background)
- **Cream:** `#F4EEE7` (high-contrast typographic body)
- **Ember:** `#FF5A1F` (accent spine and status indicators)

---

## Security Model

1. **Strict Secret Redaction:** All tool arguments, outputs, and candidate proposals are scrubbed of API keys, JWTs, OAuth tokens, private keys, environment variables, and user home directories before touching disk.
2. **Safe Filesystem Containment:** All filesystem operations use `assertInside` with canonical realpath resolution to prevent symlink traversal attacks.
3. **Zero Network Egress:** Burr never makes outbound HTTP requests, contains zero remote telemetry, and requires no cloud account or API token.
4. **Non-Destructive Integration:** Burr never overwrites user-owned `AGENTS.md`, `CLAUDE.md`, or custom editor configurations.

