# Project Dashboard

A personal command center for tracking every active project, backlog idea,
and priority in one place. Portfolio view, RAG health status, ICE-ranked
backlog, an "on fire" surface for anything overdue/red/stale, and a
soft WIP limit on active work.

Stack: Vite + React + TypeScript, Supabase (auth + Postgres), Cloudflare Pages.

## Data

Uses the shared Supabase project (`Andu7789's Project`, same one `buster`
and other personal apps run in), namespaced under the `dashboard_` prefix:

- `public.dashboard_projects` — one row per project/idea. `stage` drives
  which section it shows in (`idea` / `backlog` / `next` / `active` /
  `done` / `archived`). `ice_score` is a generated column
  (`impact × confidence × ease`). RLS scopes every row to `user_id = auth.uid()`.

## Local dev

```bash
cp .env.example .env   # already points at the shared Supabase project
npm install
npm run dev
```

Sign-in is a Supabase magic link (email OTP) — no passwords.

## Deploy to Cloudflare Pages

**Option A — Git integration (recommended):** connect this repo in the
Cloudflare dashboard (Workers & Pages → Create → Pages → Connect to Git).
Build settings:

- Framework preset: `Vite`
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
  (values in `.env.example`)

**Option B — CLI:**

```bash
npx wrangler login
npm run deploy   # builds, then `wrangler pages deploy`
```

Also add the production URL to the Supabase project's Auth → URL
Configuration → Redirect URLs, or magic-link sign-in will fail after
deploy.
