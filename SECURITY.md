# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security bugs.

Email **berengamble@gmail.com** with:

- A description of the issue and how to reproduce it
- The affected version / commit
- Any logs or proof-of-concept

You should expect an acknowledgement within 72 hours and a status update
within 7 days. If the issue is confirmed, we'll work with you on
disclosure timing — typically 30–90 days after a fix lands depending
on severity.

## What's in scope

- `packages/server/` — the native gateway: auth, sqlite, the AI proxy,
  and the esbuild compile endpoint.
- `packages/core/` — the provider abstraction, AI services, vibe-coded
  app runtime.
- `packages/web/` — the web bundle.
- The `dashterm` CLI (`cli/`).

## What's NOT in scope

- The closed-source mobile app (lives in a private repo; report mobile
  issues via the App Store / support email if you bought it).
- Anyone else's self-hosted deployment of this code.
- Vulnerabilities in upstream dependencies (Fastify, better-sqlite3, Expo,
  etc.) — report those to the respective projects directly.

## Disclosure history

None yet. This file exists so we're ready when there is one.
