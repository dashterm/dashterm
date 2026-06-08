# Contributing to DashTerm

Thanks for considering a contribution. DashTerm is a small project; the
maintainer (Beren) reviews everything personally. A few things will make
both our lives easier.

## Quick start

```bash
git clone <your-fork>
cd dashterm
npm install
cd services/compile-server && npm install && cd ../..
cd cli && npm install && npm run build && cd ..

# stand up the full backend bundle
node cli/dist/index.js homehub init
node cli/dist/index.js homehub up

# then in another terminal
npx expo start --web
```

The `dashterm homehub up` flow brings up Postgres + Supabase Auth +
Realtime + Storage + Kong + the compile server + the web bundle, applies
migrations, and prints the URLs. See [services/homehub/README.md](./services/homehub/README.md)
for the detailed install + troubleshooting guide.

## Filing issues

- **Bug reports**: include OS, Docker version, `docker compose version`,
  the failing command, and any logs from `dashterm homehub logs`.
- **Feature requests**: be honest about whether it's something you'd
  actually use yourself — the project is small and we're trying not to
  grow scope into "another all-things-to-everyone framework."
- **Security issues**: don't file a public issue. See [SECURITY.md](./SECURITY.md).

## Submitting changes

1. Fork and branch off `main`.
2. Make your change. Run `npm run typecheck` at the repo root before
   committing.
3. If you touched `services/homehub/migrations/`, manually verify that
   `dashterm homehub up` on a fresh `docker compose down -v` brings the
   stack up clean. Migrations are the most consequential part of the
   schema; we keep them idempotent.
4. Open a PR. The CI runs typecheck + lint.
5. **The CLA bot will ask you to sign the CLA on your first PR.** This is
   a one-click thing via comment ("I have read the CLA Document and I
   hereby sign the CLA"). The CLA itself is in [CLA.md](./CLA.md).

### Why a CLA?

Apache 2.0 already permits anyone (including the project maintainer) to use
contributed code in proprietary products. The CLA exists for one additional
reason: it grants Beren the right to **relicense** the project later
(e.g., dual-licensing under a commercial license). Without it, a future
relicense would require re-contacting every contributor.

The CLA is a fairly standard Apache-style ICLA with an added license-back
to the project maintainer. It does not assign your copyright — you retain
full ownership of your work.

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
- Migrations away from Supabase to a different backend. The
  StorageProvider/AuthProvider interface exists so this is *possible*, but
  we don't intend to ship alternate implementations in this repo.
