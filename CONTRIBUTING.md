# Contributing to DashTerm

Thanks for considering a contribution. DashTerm is a small project; the
maintainer (Beren) reviews everything personally. A few things will make
both our lives easier.

## Quick start

```bash
git clone <your-fork>
cd dashterm
npm install          # postinstall builds packages/server + the CLI

# run the gateway + Expo dev server together, with hot reload
npm run dev
```

`npm run dev` starts the native gateway (`packages/server`) on :8765 and the
Expo web dev server on :8081 — open http://localhost:8081. On first boot the
gateway seeds a default admin (`admin@localhost` / `changeme`) and forces you
to rotate it. Compilation of vibe-coded apps lives in
`packages/server/src/compilation` and is served at `POST /api/compile` by the
same gateway.

## Filing issues

- **Bug reports**: include OS, Node version (`node -v`), the failing
  command, and any gateway logs (`dashterm daemon logs`, or the stderr from
  `dashterm start`).
- **Feature requests**: be honest about whether it's something you'd
  actually use yourself — the project is small and we're trying not to
  grow scope into "another all-things-to-everyone framework."
- **Security issues**: don't file a public issue. See [SECURITY.md](./SECURITY.md).

## Submitting changes

1. Fork and branch off `main`.
2. Make your change. Run `npm run typecheck` at the repo root before
   committing.
3. If you touched `packages/server/src/migrations/`, verify a fresh
   `dashterm start` against an empty data dir applies them clean
   (`DASHTERM_DATA_DIR=$(mktemp -d) dashterm start`). Migrations are the
   most consequential part of the schema; we keep them idempotent.
4. Open a PR. The CI runs typecheck + lint.
5. **The CLA bot will ask you to sign the CLA on your first PR.** This is
   a one-click thing via comment ("I have read the CLA Document and I
   hereby sign the CLA"). The CLA itself is in [CLA.md](./CLA.md).

### Why a CLA?

DashTerm is released under the [Functional Source License](./LICENSE)
(`FSL-1.1-ALv2`), which reserves competing commercial use to the maintainer and
converts to Apache 2.0 two years after each release. The CLA grants Beren a
license-back to your contribution so the project can:

- offer DashTerm commercially and in the proprietary mobile app, and
- **relicense** later (e.g., dual-licensing, or moving to a more permissive
  license) without having to re-contact every contributor.

It does not assign your copyright — you retain full ownership of your work, and
the open-source license you grant under Sections 2–3 of the CLA is irrevocable.

## Style

- TypeScript everywhere except the SQL migrations + Dockerfiles.
- Two-space indent, no semicolons in JS files except where Prettier insists.
- Match the surrounding code's style. We're not going to litigate this.
- New code should pass `npm run typecheck`. CI will reject otherwise.

## Code of Conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
TL;DR: be decent.

## What's NOT in scope

- Mobile app code. The native mobile app is a separate (closed-source)
  product that connects to this backend; it lives in a private repo. PRs
  to add mobile/native bits will be politely closed.
- Hosted-tier infrastructure. This is a self-host-first project. If you
  want a managed-hosting feature, please open an issue to discuss first —
  we may say no.
- Alternate storage/auth backends. The StorageProvider/AuthProvider
  interface exists so this is *possible*, but the native sqlite gateway is
  the only implementation we ship in this repo.
