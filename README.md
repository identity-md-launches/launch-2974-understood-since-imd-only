# Hamster Friendship

A small browser game. You guide a hamster to catch sunflower seeds (1 point), collect hearts to
make friends (5 points each; friends follow you around) and dodge prickly burrs (3 lives). Anyone
can play as a guest. Players who connect a wallet and sign one free message get their best score
ranked on a public **Top 100** leaderboard, stored in **your own Supabase project**.

The site is a static export (`dist/`) suitable for IMD's IPFS hosting. No backend runs on IMD:
the database and the Edge Functions live in Supabase, which you configure separately (below).

## Decisions made for this step

| What was open | What was chosen | Why |
| --- | --- | --- |
| The brief says to extend "the existing Hamster Friendship project", but the repository contained no game source, assets or manifest (only an empty commit). An earlier run stopped to ask for the files; nobody answered. | The game is implemented in this repository from the brief's description: a hamster friendship arcade game, built as plain HTML, CSS and JavaScript modules in `site/`. | Stopping again would deliver nothing. If the original project turns up, its game loop can replace `site/js/game.js`. The wallet, leaderboard and Supabase layers only depend on `createGame()`'s `onState("over", { score, seeds, friends, durationMs })` callback. |
| Supabase project URL and anon key | Left empty in `site/config.js` / `dist/config.js`. That is an owner setting, listed under "After launch". | Only you can create the project. Until both values are set, the game runs guest-only and the Top 100 says it is not connected yet. |
| Allowed origins for the Edge Functions | `ALLOWED_ORIGINS` secret, optional. | Your final gateway URL or ENS name is not known yet. Every write is authenticated by a wallet signature, so an open CORS policy is safe in the meantime. |
| Wallet stack | No SDK. MetaMask and other extensions are discovered by EIP-6963. A plain `window.ethereum` is the fallback. Phones get "Open in MetaMask / Coinbase Wallet / Phantom" links. | The brief asks for optional MetaMask. Signing a message needs no chain, no transaction and no relay, so wagmi/viem would only add weight to the export. |
| Score security | Server-opened runs, server clock, plausibility rules and one atomic best-score upsert. | A browser game cannot prove a score. These checks make forging one costly and keep guests out of the ranking. See "Security model". |

## Project layout

```
site/                     source of the static site (edit these)
  index.html              page, meta tags (title, description, og:*), favicon link
  style.css               design tokens and components (see DESIGN.md)
  config.js               OWNER SETTING: Supabase URL + anon key (public values)
  favicon.svg, og-image.svg
  js/game.js              canvas game engine (rules, drawing, input API)
  js/app.js               UI wiring: overlay, HUD, controls, leaderboard, wallet sheet
  js/api.js               Supabase REST + Edge Function calls (fetch, no SDK)
  js/wallet.js            EIP-6963 discovery, connect, personal_sign, open-in links
dist/                     committed static export (copy of site/ + filled config.js)
scripts/build.mjs         builds dist/ from site/ (no dependencies)
scripts/preview.mjs       serves dist/ at http://localhost:4173/preview/
tests/rules.test.mjs      node:test checks for the score rules
supabase/
  config.toml             CLI config: JWT check off for the 5 functions (they authenticate themselves)
  migrations/20261104120000_hamster_leaderboard.sql   schema, RLS, view, functions
  functions/_shared/      CORS/JSON helpers, service-role client, sessions, score rules
  functions/auth-nonce    issues a Sign-In with Ethereum (EIP-4361) message
  functions/auth-verify   checks the signature, returns a session token
  functions/auth-signout  revokes a session token
  functions/run-start     opens a ranked run (server timestamp)
  functions/score-submit  validates a finished run and keeps the best score per wallet
DESIGN.md                 implemented design system
artifacts/validation.md   checks run, review findings, limitations
```

## Install, preview, rebuild

Requires Node 20 or newer. The site has **no npm dependencies**: `package-lock.json` only records
the root package.

```sh
npm install            # nothing to download; keeps the lockfile in sync
npm run build          # site/ -> dist/ ; fills dist/config.js from PUBLIC_SUPABASE_* if set
npm run preview        # http://localhost:4173/preview/ (served under a subpath, like a gateway)
npm test               # score-rule unit tests (node --test)
npm run typecheck      # JSDoc type check of site/js with TypeScript (fetched by npx)
```

Build with the leaderboard connected:

```sh
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co \
PUBLIC_SUPABASE_ANON_KEY=<anon-or-publishable-key> \
npm run build
```

Then commit `dist/`: the publisher serves the committed export and does not rebuild. Every asset
URL is relative (`./style.css`, `./js/app.js`), so the export works at an IPFS gateway subpath or an ENS name.

You can also skip the build and edit `dist/config.js` directly. It is a plain, commented file.

## Environment variables

### Frontend (build time, public)

| Name | Required | Where it goes | Value |
| --- | --- | --- | --- |
| `PUBLIC_SUPABASE_URL` | for ranking | `dist/config.js` → `supabaseUrl` | `https://<project-ref>.supabase.co` (Project Settings → API) |
| `PUBLIC_SUPABASE_ANON_KEY` | for ranking | `dist/config.js` → `supabaseAnonKey` | The **anon** (legacy) or **publishable** (`sb_publishable_…`) key. Never the service role / secret key: the build refuses keys that look like one. |

Both are public by design. Row level security limits the anon key to reading `best_scores` and `leaderboard_top100`.

### Edge Functions (Supabase secrets)

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SUPABASE_URL` | yes | injected by Supabase | Project URL, used by the service-role client |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | injected by Supabase | Server-side writes. Never leaves Supabase. |
| `ALLOWED_ORIGINS` | no | any origin | Comma-separated origins allowed to call the functions, e.g. `https://hamster.eth.limo,https://<cid>.ipfs.dweb.link`. Requests from other origins get 403. |
| `SESSION_TTL_DAYS` | no | `7` | How long a wallet session token lasts |
| `MAX_RUNS_PER_HOUR` | no | `60` | Ranked games one wallet may start per hour |

Set the optional ones with `supabase secrets set NAME=value`.

## What to configure in Supabase

1. **Create a project** at supabase.com (any region). Note the project ref, URL and anon/publishable key (Project Settings → API).
2. **Install the Supabase CLI** and log in: `npx supabase login` (or a global install).
3. **Link this repository** from its root: `npx supabase link --project-ref <project-ref>`.
4. **Apply the migration**: `npx supabase db push`. This creates `players`, `auth_nonces`,
   `wallet_sessions`, `game_runs`, `best_scores`, the `leaderboard_top100` view, and the
   `record_score` and `prune_expired_auth` functions, all with row level security on.
   (Alternative: paste `supabase/migrations/20261104120000_hamster_leaderboard.sql` into the SQL editor.)
5. **Deploy the Edge Functions** (verify-JWT is off for each, as `supabase/config.toml` sets):
   ```sh
   npx supabase functions deploy auth-nonce
   npx supabase functions deploy auth-verify
   npx supabase functions deploy auth-signout
   npx supabase functions deploy run-start
   npx supabase functions deploy score-submit
   ```
6. **Optional secrets**: `npx supabase secrets set ALLOWED_ORIGINS=https://your-site.example`.
7. **Optional housekeeping**: enable the `pg_cron` extension (Database → Extensions) and schedule
   `select cron.schedule('hamster-prune', '17 3 * * *', 'select public.prune_expired_auth()');`
8. **Connect the site**: rebuild with `PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY` (or edit
   `dist/config.js`), commit `dist/`, and let IMD publish the new export.
9. **Check it**: open the site, select "Connect wallet", choose MetaMask, sign the message, play
   a round, and confirm your address appears in the Top 100. In Supabase, `select * from best_scores;`
   shows the row.

Nothing in this repository deploys to Supabase by itself. These steps are yours to run.

## How it works

**Guest play.** Nothing is sent anywhere. The best guest score is kept in `localStorage`
(`hf.guestBest`) and shown in the HUD. Guests never open a ranked run, so guest scores can
never reach the leaderboard.

**Wallet sign-in** (optional, free, no transaction):

1. The browser asks `auth-nonce` for a challenge. The server writes an EIP-4361 message (domain, address, nonce, 10-minute expiry) and stores it.
2. The wallet signs it with `personal_sign`.
3. `auth-verify` spends the nonce atomically, recovers the signer from the **stored** message (viem `recoverMessageAddress`), and, if the signer matches, upserts the player and returns a random 32-byte session token. Only its SHA-256 is stored.
4. The browser keeps the token in `localStorage` (`hf.session`) and sends it as `x-session-token`.

**Ranked run:**

1. On Play, `run-start` opens a run stamped with the server's clock. A wallet has at most one open run, and runs are rate-limited per hour.
2. On game over, `score-submit` checks that the run belongs to the wallet and is still open. It then checks the claim with `supabase/functions/_shared/rules.js`: score must equal `seeds + 5 × friends`, the claimed duration must fit inside the server-observed time, catches cannot exceed what the spawner can drop in that time, and the run must be younger than two hours.
3. `public.record_score` closes the run and keeps the **best score per wallet** in one transaction. It returns the best score, whether it is new, and the rank.

**Leaderboard.** The browser reads `leaderboard_top100` (rank, wallet, best score, reached at)
through PostgREST with the anon key. Ties are ordered by who reached the score first.

## Security model and limits

- The browser can only read `best_scores` and `leaderboard_top100`. All writes go through the Edge Functions with the service role key.
- Signatures are checked against server-stored messages, nonces are single-use with a 10-minute expiry, and session tokens are stored hashed and can be revoked (`auth-signout`).
- **Limit:** any client-side game can be automated. A bot that plays at human-plausible speed through the real API can post a plausible score. The rules stop forged or impossible scores, not skilled automation.
- **Limit:** only 65-byte EOA signatures are accepted. Smart-contract wallets (ERC-1271, Coinbase Smart Wallet passkeys) are not supported by `auth-verify`.

## After launch

| Setting | Where | Until it is set |
| --- | --- | --- |
| Supabase URL + anon/publishable key | `site/config.js` via `PUBLIC_SUPABASE_*` at build, or `dist/config.js` directly | Guest-only play; the Top 100 shows "opens once the leaderboard service is connected"; the wallet can connect but sign-in is not offered |
| `ALLOWED_ORIGINS` | Supabase secret | Functions accept any origin (writes still require a wallet signature) |
| Final site URL for `og:image` | `site/index.html` | `og:image` is the relative `./og-image.svg`; some link unfurlers need an absolute PNG URL |

## Validation

This step's commands could **not** be run on the build machine. The shell sandbox failed to
start on every attempt ("Failed to create bridge sockets"), and the browser tool could not start
either ("Socket directory path is too long"). So `npm run build`, `npm test`, `npm run typecheck`,
the taste probe and every browser check are **unperformed**. `dist/` was written by hand as a
file-for-file copy of `site/`, which is exactly what `scripts/build.mjs` produces when the
`PUBLIC_SUPABASE_*` variables are unset. Run `npm run build && npm test && npm run typecheck` once
locally to confirm. Details, the source review and its findings are in `artifacts/validation.md`.

## Repository hygiene

`.gitignore` excludes only generated or cache paths: `node_modules/`, `.npm/`, `.cache/`,
`supabase/.temp/`, `supabase/.branches/`, `test/scratch/`, `*.tgz`, `*.log`, and `.env*`.
Path budget: the committed tree is source, `dist/` (about 70 KB) and documentation, far under the 8 MiB limit.
