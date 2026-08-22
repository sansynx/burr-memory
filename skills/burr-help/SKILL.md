---
name: burr-help
description: One-screen Burr command reference. Use when the user says /burr-help or asks how Burr works.
---

# Burr help

Print this and stop:

Burr keeps debugging memory in `.burr/` in this project.

/burr [on|strict|off]   status or set mode
/burr-search            search local memory before guessing
/burr-capture           save a reusable failure
/burr-resolve           write a playbook after a verified fix
/burr-audit             usage from usage.jsonl
/burr-help              this screen

Codex: @burr-search (and the other names).
Pi: /skill:burr-search (and the other names).
Cursor and Windsurf: always-on rule only; no slash commands.

Mode on = search before non-trivial fixes. strict = do not patch until a search ran. off = silent.
