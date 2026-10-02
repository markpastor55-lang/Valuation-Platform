# Notes for coding agents

- Monorepo: pnpm workspaces. `packages/domain` (pure TS, no I/O) is the single source of truth for
  requirements, validation, calculations, geometry, permissions, workflow and audit; `apps/api` only
  persists, authenticates and orchestrates. `apps/preview` is a browser-only preview that calls the
  domain directly with synthetic data. Put business rules in the domain package, never in the preview.
- Run `pnpm check` before committing (format, lint, typecheck, tests, generated docs). After changing
  rules, permissions, fields, formulas, validation rules or routes, run `pnpm docs:generate` and commit
  the regenerated `docs/spec/generated/*` and `docs/spec/02-personas-and-permissions.md`.
- Vocabulary (codes, permission names, audit actions, `[REVIEW: ROLE]` tags) is defined in
  `docs/spec/00-architecture-and-conventions.md`. Do not invent new names without updating it.
- Never edit an applied SQL migration — add a new numbered file. Formula, rule-set and template
  versions are immutable once used; add versions.
- API tests use embedded PostgreSQL (PGlite, single connection): never open a second transaction
  while one is active (authorisation denials are recorded by the error handler for this reason).
- Guardrails are product requirements: AI never certifies, approves, accepts facts or issues; only the
  responsible valuer signs (human + MFA); QA reviewer ≠ valuer unless an authorised exception exists;
  external data needs full provenance; nothing claims "compliance".
