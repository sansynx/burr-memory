# Burr

<p align="center">
  <img src="assets/burr-mark.svg" width="112" height="112" alt="Burr mark: cream burr on ink, one ember spine">
</p>

<p align="center">
  <strong>Agents that remember how they got unstuck.</strong><br>
  A burr is a seed that hooks on and rides with the next passerby.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-F4EEE7?style=flat&labelColor=0F0F0E" alt="MIT license"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D18-F4EEE7?style=flat&labelColor=0F0F0E" alt="Node 18+"></a>
  <a href="https://www.npmjs.com/package/burr-memory"><img src="https://img.shields.io/npm/v/burr-memory?style=flat&label=npm&labelColor=0F0F0E&color=FF5A1F" alt="npm version"></a>
  <img src="https://img.shields.io/badge/cloud-none-F4EEE7?style=flat&labelColor=0F0F0E" alt="No cloud">
</p>

```bash
npm install -g burr-memory
burr global
```

That turns Burr on for every project. Playbooks live in **`~/.burr/memory/`** on this machine, so a compacted session or an agent in another repo can reuse the same fix.

One repo only:

```bash
npm install -D burr-memory
npx burr init
```

No account. No API key. No network after install.

Playbooks live on **this machine**, not on a server and not in one repo:

```
~/.burr/memory/
  playbooks/                 verified fixes (all your projects)
  signals/                   reusable failures

your-project/
  .burr/
    config.json              mode: on | strict | off
    instructions.md          always-on rule
    usage.jsonl              search / hit / miss / capture / resolve / promote / discard
    skills/                  owned copies of the seven commands
```

If you resolve a Prisma singleton bug in `shop`, the next agent in `billing` — or a compacted session in `shop` — searches `~/.burr/memory/` and rides that playbook. `burr global` writes editor rules under your home directory. Capture and resolve write the memory there too.

---

## What is Burr?

Burr is a **local learning and reliability runtime for coding agents**. 

It observes how an agent interacts with tools, detects when an agent gets stuck in repetitive execution loops, learns from successful and unsuccessful tool usage, compresses verified solutions into bounded local memory, and injects that memory into future sessions so fresh agents become measurably faster and more reliable over time.

---

## Why Agents Loop

Autonomous agents frequently fall into repetitive trap loops:
- **Exact repetition:** Running identical failing test commands or repeating queries without altering inputs.
- **Fuzzy repetition:** Re-running searches or shell commands with trivial whitespace or semantic alterations that produce the exact same error.
- **Cyclic exploration:** Falling into repeating cycles of tool calls (e.g. `grep -> find -> test -> grep -> find -> test`).
- **Output stagnation:** Repeatedly getting identical stack traces or empty search results while continuing down dead-end hypotheses.

Because language models generate tokens step-by-step from context, they struggle to step outside their own generation trajectory to recognize when they have stagnated. Burr acts as an external deterministic runtime watcher that intercepts these patterns before tokens and time are wasted.

---

## Why Agents Forget

Agent context is inherently fleeting:
- When a context window fills up, compaction drops the precise commands, build steps, and environment lessons that led to the solution.
- When a fresh task starts in the same repository, a new agent session begins with zero recall of repository conventions, required build sequences, or tricky dependency quirks.

Burr bridges this gap by persisting verified lessons into structured machine-local memory that survives session resets and context compaction.

---

## High-Level Architecture

```text
               CODING AGENTS & ORCHESTRATORS
    (Claude Code / Codex / Cursor / Windsurf / Pi / OpenCode)
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

---

## How Burr Learns

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
Burr runtime ledger records action & evaluates loop risk
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

## What Burr Decides NOT to Remember (Anti-Bloat & Decay)

Unrestricted agent memory quickly degrades. Burr enforces strict admission and decay criteria:

1. **Ephemeral Noise Rejection:** Temporary environment quirks (port in use, down dev server, missing local unbuilt build artifact) are discarded immediately and never promoted.
2. **Mandatory Verification Gate:** A candidate lesson is never promoted to long-term memory unless the fix was explicitly verified with a passing test, compiler run, or reproduction check.
3. **Deduplication & Merging:** If a newly learned strategy matches an existing memory, Burr merges them—updating the observation count and confidence score rather than adding duplicate entries.
4. **Autonomous Memory Decay & Pruning:**
   - Active memories unused for 30 days degrade to `stale` with retrieval score penalties.
   - After 60 days of inactivity, stale memories are archived.
   - Ephemeral session ledgers (`runs/`) are pruned automatically after a 3–7 day TTL.

---

## OpenAI Codex Runtime Hooks

Burr provides native integration with OpenAI Codex lifecycle events (`src/codex/hooks.ts`):

- **`PreToolUse`**: Checks proposed tool actions against recent session history. Flags loops with transparent risk scoring (+40 exact, +25 fuzzy, +30 cycles, +20 stagnation). Blocks actions when risk $\ge 70$.
- **`PostToolUse`**: Computes cryptographic hashes of tool outputs, tracks stagnation, and updates the action ledger.
- **`SessionStart`**: Retrieves top-k scoped memories (matching repository, language, and query tokens) and injects active guidance into the session context.
- **`SessionEnd`**: Evaluates task verification, runs self-reflection, scores tool utility, and consolidates new lessons into active memory.
- **`PreCompact` / `PostCompact`**: Preserves active context and learned insights across context compaction events.

---

## Install

```bash
npm install -g burr-memory
burr global
```

Or in one repo: `npm install -D burr-memory` then `npx burr init`.

`init` and `global` write Burr's own files only (write-if-missing). They do **not** edit `AGENTS.md`, `CLAUDE.md`, or any existing foreign rule. Second run does not overwrite your edits.

From a clone of this repo:

```bash
npm install
npm test
npm run build
```

---

## Commands

| Claude / OpenCode | Codex | Pi | What it does |
|---|---|---|---|
| `/burr [on\|strict\|off]` | `@burr` | `/skill:burr` | Status, or set mode |
| `/burr-search` | `@burr-search` | `/skill:burr-search` | Search shared memory on this machine |
| `/burr-capture` | `@burr-capture` | `/skill:burr-capture` | Save a reusable failure |
| `/burr-resolve` | `@burr-resolve` | `/skill:burr-resolve` | Write a playbook after a verified fix |
| `/burr-promote` | `@burr-promote` | `/skill:burr-promote` | Lift an old project-only playbook into shared memory |
| `/burr-audit` | `@burr-audit` | `/skill:burr-audit` | Usage from `usage.jsonl` |
| `/burr-help` | `@burr-help` | `/skill:burr-help` | This screen |

Cursor and Windsurf get the always-on rule only (no slash commands).

CLI commands:

```bash
# Core debugging workflow
burr init
burr search "hydration mismatch"
burr capture --error "TypeError: ..." --command "npm test"
burr resolve --error "..." --cause "..." --fix "..." --verify "npm test — 12 passed"
burr promote
burr audit
burr on | strict | off

# Reliability & learning analytics
burr stats
burr compare <run-id-1> <run-id-2>
burr memory summary
burr memory list --type knowledge
burr memory inspect <memory-id>
burr memory prune
burr doctor

# Local offline visual dashboard
burr dashboard --port 4747
```

---

## Hosts

| Host | Always-on | Commands | `init` writes |
|---|---|---|---|
| Claude Code | skill descriptions | `/burr*` via `.claude/skills` | those skill copies |
| Codex | `@` `.burr/instructions.md` | `@burr*` via plugin / visible skills | `.agents/skills` |
| OpenCode | plugin injects the rule | `/burr*` via plugin | `.opencode/plugins/burr.mjs` + json merge |
| Pi | skill descriptions | `/skill:burr*` | `.pi/skills` and `.agents/skills` |
| Cursor | `.cursor/rules/burr.mdc` | none | that rule file |
| Windsurf | `.windsurf/rules/burr.md` | none | that rule file |

Canonical skills live once in `skills/`. `init` creates the host-specific
copies and adapters each tool expects.

---

## Multi-Session Benchmark: Progression Over Time

Evaluated using **AO (Agent Orchestrator)** across four sequential GitHub repository tasks on an unindexed codebase:

```text
RUN       TASK                               CALLS      WASTED      LOOPS      MEMORY HITS      TIME
1         Monorepo ESM Resolver                 10           3          2                0     194ms
2         Circular Dependency Fix                4           0          0                1      67ms
3         Path Containment Safe FS               3           0          0                1      37ms
4         Storage Integrity Doctor               2           0          0                1      18ms
```

### Measured Progression:
- **80% drop in tool calls** by Run 4 as learned repository rules and tool strategies were reused.
- **100% elimination of wasted calls and loops** after Run 1.
- **75% memory hit rate** (Run 1 was cold start; Runs 2–4 retrieved relevant active rules).
- **Strictly bounded memory:** Stored active memories remained fixed at 5 items (<12 KB storage).

---

## Visual Identity & Local Dashboard

Burr includes an offline, zero-dependency visual dashboard at `http://127.0.0.1:4747` (`burr dashboard`):
- **Ink:** `#0F0F0E` (deep workspace background)
- **Cream:** `#F4EEE7` (high-contrast typographic body)
- **Ember:** `#FF5A1F` (accent spine and status indicators)

---

## Local store

Playbooks and signals are **`~/.burr/memory/`** on this machine. Shared across your projects and sessions. Not committed. Not uploaded.

The project's `.burr/` is config, usage, and host copies. `init` gitignores it so leftover local files stay off the remote.

---

## Security

Debugging input is treated as untrusted.

- Redact tokens, JWTs, private keys, passwords, home paths, emails, and query-string secrets before any disk write.
- Bound sizes (12k text, 20 attempts).
- Refuse symlink project roots during init and writes outside approved roots.
- Never store source trees, `.env` contents, or customer data.
- `init` never asks for a key and never calls a network.

---

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

Layout:

```
skills/           seven canonical SKILL.md files
templates/        config.json + always-on rule
src/shared/       redaction, admission, search, ledger, safe fs
src/cli/          init + global + search / capture / resolve / promote / audit
test/hosts/       one suite per coding agent
test/edges/       bounds, secrets, path escape
```

---

## Contributing

Bug reports and pull requests are welcome.

Burr is a local learning and reliability runtime. Please do not add a remote hosted API, cloud dashboard, account system, or background telemetry process. `init` and `global` may only create Burr’s own files; they must never modify a user’s `AGENTS.md`, `CLAUDE.md`, or other existing instruction files.

The mark is locked: ink `#0F0F0E`, cream `#F4EEE7`, and ember `#FF5A1F` on the spine at about 2 o’clock. No wordmark or letters.

Please include tests for new behavior (`npm test`) and write a short commit message in your own name.

---

## License

[MIT](LICENSE)
