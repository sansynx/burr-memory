# Burr architecture

Burr stores debugging memory on the local machine. It has two entry paths.

## Skills and CLI

`skills/` and `templates/` define the agent workflow. `burr init` copies owned files into a project; `burr global` installs user-level skills and supported Codex/OpenCode hooks. Cursor and Windsurf global settings require manual setup. Existing user instructions and edited copies are preserved.

`src/shared/memory.ts` implements search, capture, resolve, and promotion. Signals and verified playbooks are Markdown files under `~/.burr/memory/`. A project's `.burr/` holds config, instructions, generated skills, and a usage ledger.

## Optional runtime integration

The `/api`, `/runtime`, `/learning`, and `/codex` package exports expose the runtime. The root export is the OpenCode plugin.

A custom host calls pre-tool checks, executes allowed actions, records results, and supplies verification evidence at session completion. The host must enforce a blocking result. Installing skills does not wire these hooks into every agent.

- `src/runtime/` fingerprints actions, evaluates repetition, and stores run ledgers.
- `src/codex/hooks.ts` coordinates checks, retrieval, reflection, and metrics.
- `src/learning/` admits, merges, retrieves, and prunes runtime JSON memories.
- `src/metrics/` aggregates runtime events.
- `src/cli/dashboard.ts` serves the runtime dashboard over loopback HTTP.

Runtime JSON memories and CLI Markdown playbooks have separate retrieval paths. The dashboard displays runtime data; `burr search` and `burr audit` expose the CLI workflow.

## Storage and maintenance

```text
~/.burr/
  memory/playbooks/       CLI Markdown playbooks and exported runtime playbooks
  memory/signals/         reusable CLI failure signals
  memory/knowledge/      runtime knowledge, playbook records, repository rules, and avoid lessons
  memory/tool-strategies/ runtime tool strategies
  candidates/            runtime candidate lessons
  archive/               archived runtime memories
  runs/                  runtime action ledgers
  metrics/               runtime event ledger
```

`burr memory prune` explicitly applies decay and run retention. Defaults are 30 days to stale, 60 days to archive, and seven days for runs. There is no background pruning service or fixed 12 KB total storage guarantee.

## Trust boundaries

Verification comes from the caller; Burr does not run tests on its behalf. Redaction filters known secret patterns before persistence, but callers must not submit source trees, `.env` contents, or customer data. Guarded filesystem helpers enforce containment and reject linked paths for protected operations.

Learning mutations use a home-wide lock. Candidate/session receipts prevent replay from inflating evidence. Scope identity includes repository, language, framework, package, version, and tool; explicit mismatches are excluded from retrieval. Stored records are validated and retrieved text is quoted as untrusted historical data. Archiving removes generated Markdown as well as active JSON. Reflected playbooks retain bounded problem, cause, fix, and verification fields.

Replacement writes are staged in the same directory and flushed before rename. Locks identify their owner process and serialize stale-lock recovery; orphaned recovery locks use the same recovery procedure. This is local filesystem coordination, not a multi-file database transaction or protection against a malicious process running as the same OS user.

The dashboard binds to loopback, restricts host and origin headers, and escapes stored text before HTML rendering. Burr has no hosted memory service or telemetry endpoint.

## Test evidence

`npm run check` runs type checks and regression tests, including host installation, redaction, filesystem safety, runtime hooks, retrieval, and CLI behavior. `npm pack --dry-run` builds and checks the package contents. The four-session benchmark test is a scripted fixture with supplied outputs, not a measured autonomous agent evaluation.
