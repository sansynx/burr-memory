# Burr

<img src="assets/burr-mark.svg" width="96" height="96" alt="Burr">

Local debugging memory for coding agents. A burr is a seed that hooks on and rides with the next passerby.

```bash
npm install -D burr-memory
npx burr init
```

The product and CLI are **Burr**. The npm name is `burr-memory` because [`burr`](https://www.npmjs.com/package/burr) is already taken by an unrelated 2013 compiler. After install, the binary is still `burr`.

No account. No key. No network after install. Memory lives in `.burr/` in this project.

## Hosts

| Host | Always-on | Commands |
|---|---|---|
| Claude Code | skill descriptions | `/burr`, `/burr-search`, `/burr-capture`, `/burr-resolve`, `/burr-audit`, `/burr-help` |
| Codex | `@` `.burr/instructions.md`, or the plugin | `@burr-search` (and the other names) |
| OpenCode | plugin injects the rule | `/burr-search` (and the other names) |
| Pi | skill descriptions | `/skill:burr-search` (and the other names) |
| Cursor | `.cursor/rules/burr.mdc` | always-on rule only |
| Windsurf | `.windsurf/rules/burr.md` | always-on rule only |

`init` writes Burr's own files only. It does not edit `AGENTS.md`, `CLAUDE.md`, or any existing foreign rule.

## Commands

```
/burr [on|strict|off]   status or set mode
/burr-search            search local memory before guessing
/burr-capture           save a reusable failure
/burr-resolve           write a playbook after a verified fix
/burr-audit             usage from usage.jsonl
/burr-help              this screen
```

Mode `on` = search before non-trivial fixes. `strict` = do not patch until a search ran. `off` = silent.

## Local store

```
.burr/
  config.json           { "mode": "on" }
  instructions.md
  memory/playbooks/
  memory/signals/
  usage.jsonl
  skills/
```

Search is filename + YAML frontmatter + token overlap. No embeddings. Secrets are redacted before any disk write.

## From this repo

```bash
npm install
npm test
npm run build
```
