# Burr contributor guidance

## Product contract

- Burr is local debugging memory for coding agents.
- Shared playbooks and signals live in `~/.burr/memory/`.
- A project's `.burr/` contains config, usage, and generated host copies only.
- Keep Burr offline: no account, hosted API, telemetry service, or remote memory.

## Canonical sources

- Edit skills in `skills/`, instructions in `templates/`, and runtime code in `src/`.
- `.opencode/plugins/burr.mjs` and `pi-extension/index.ts` are shipped host adapters.
- Do not commit generated host copies under `.agents/`, `.claude/`, `.cursor/`,
  `.pi/`, `.windsurf/`, or `.opencode/command/`.
- Do not commit `.burr/`, `dist/`, package tarballs, or test output.

## Safety

- Never commit real tokens, credentials, customer data, home paths, or `.env` contents.
- Secret-redaction tests must use unmistakably synthetic values assembled from short
  fragments at runtime so secret scanners do not flag the repository.
- Route writes through the guarded helpers in `src/shared/fs.ts`; do not bypass path
  containment or symlink checks with direct filesystem writes.
- Preserve user-edited rules, skills, config fields, and host configuration.

## Change discipline

- Add a regression test before fixing a bug.
- Run `npm run check` and `npm pack --dry-run` before completion.
- Keep the npm package surface limited to canonical sources and built output.
- Update README, templates, skills, and host tests together when behavior changes.
