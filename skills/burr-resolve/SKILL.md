---
name: burr-resolve
description: Write a Burr playbook after a verified fix. Use when the user says /burr-resolve or a debug is done and verified.
---

# Burr resolve

1. Require root cause, fix, and real verification text (test run, reproduced-and-gone, measured check). If verification is missing, refuse.
2. Run admission. Refuse ephemeral junk.
3. Redact every field. Write `.burr/memory/playbooks/<signature-or-slug>.md` with sections Error, Root Cause, Fix, Failed Attempts, Verification, Context.
4. Append usage.jsonl verb `resolve` with path.
5. No playbook for "I think it's fixed" without evidence.
