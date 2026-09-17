# Project Dashboard

A personal command center for tracking every active project, backlog idea,
and priority in one place. Portfolio view, RAG health status, ICE-ranked
backlog, an "on fire" surface for anything overdue/red/stale, and a
soft WIP limit on active work.

Stack: Vite + React + TypeScript, Supabase (auth + Postgres), Cloudflare Workers (static assets).

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

## Deploy to Cloudflare Workers

Project: **apps-dashboard** (Workers & Pages → apps-dashboard). Deployed as
a Worker serving static assets (`[assets]` in `wrangler.toml`), built via
Cloudflare's git integration — build command `npm run build`, deploy
command `wrangler deploy`.

Production domain: **abdashboard.site**

**Required — build variables.** The project's Settings → Variables and
Secrets must have `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set
(values in `.env.example`). Vite inlines these at build time; without
them the app throws immediately on load.

**CLI alternative:**

```bash
npx wrangler login
npm run deploy   # builds, then `wrangler deploy`
```

### One-time manual setup (not scriptable from here)

1. **Attach the domain.** Project → Domains tab → Add → enter
   `abdashboard.site`. If the zone is on the same Cloudflare account this
   auto-provisions DNS; only add DNS records by hand if that step
   surfaces an explicit error asking for one.
2. **Register the redirect URL.** In the Supabase project's dashboard →
   Authentication → URL Configuration:
   - Site URL: `https://abdashboard.site`
   - Redirect URLs: add `https://abdashboard.site/**`

   Magic-link sign-in will fail on the live domain until this is done
   (it currently points at `http://localhost:5173`).
