# Development Guide

This guide has two parts:

1. **[Local dev setup](#local-dev-setup)** — what you need to run the app on your laptop. Start here if you just joined the team.
2. **[Deploying a hosted environment](#deploying-a-hosted-environment)** — how the founder set up prod / dev on Vercel + Supabase. You only need this if you're spinning up a new deployed environment.

---

## Local dev setup

The app uses a **local Supabase stack** for development, powered by the Supabase CLI. Every developer runs their own isolated Postgres + Auth + Storage on their laptop. No shared secrets, no hosted-DB credentials to chase down.

### Prerequisites

| Tool          | Version            | Install                                                                                   |
|---------------|--------------------|-------------------------------------------------------------------------------------------|
| Node.js       | 20.x or 22.x       | [nodejs.org](https://nodejs.org) or `nvm install 22`                                      |
| npm           | bundled with Node  | —                                                                                         |
| Docker        | any recent version | [docker.com](https://www.docker.com/products/docker-desktop) — launch Docker Desktop and wait ~10s for the whale icon to stop animating |
| Supabase CLI  | ≥ 2.90             | macOS: `brew install supabase/tap/supabase`. Other: [docs](https://supabase.com/docs/guides/local-development/cli/getting-started) |

Verify:

```bash
node --version       # v20.x or v22.x
docker info          # should print "Server Version: ...", not "Cannot connect to the Docker daemon"
supabase --version
```

> The repo already ships a `supabase/config.toml`, so **don't** run `supabase init` — it would clobber the committed config. Just `supabase start`.

### 1. Clone and install

```bash
git clone https://github.com/sakuya9t/vegedog_badminton_webapp.git
cd vegedog_badminton_webapp
npm install
```

### 2. Start the local Supabase stack

From the repo root:

```bash
supabase start
```

First run pulls Docker images (~2–3 minutes). Subsequent runs take ~10 seconds.

> If you hit `toomanyrequests: Rate exceeded` from Docker Hub on first run, the CLI auto-retries after a few seconds. Wait it out; you don't need to do anything.

When it finishes you'll see boxed output with URLs and a `🔑 Authentication Keys` table showing `Publishable` / `Secret` values (prefixed `sb_publishable_...` / `sb_secret_...`). These are the new short-form API keys.

`supabase start` automatically applies [`supabase/schema.sql`](../supabase/schema.sql) as seed SQL, so your local DB matches production on first boot.

### 3. Create your `.env.local`

```bash
cp .env.local.example .env.local
```

The easiest way to get the keys in the format `.env.local` expects:

```bash
supabase status -o env
```

This prints `ANON_KEY=...`, `SERVICE_ROLE_KEY=...`, and `API_URL=...` as JWT-format strings (long `eyJ...` tokens). Copy those values into `.env.local`:

| `.env.local` variable           | Maps to              |
|---------------------------------|----------------------|
| `NEXT_PUBLIC_SUPABASE_URL`      | `API_URL`            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY`           |
| `SUPABASE_SERVICE_ROLE_KEY`     | `SERVICE_ROLE_KEY`   |

Leave `NEXT_PUBLIC_SITE_URL=http://localhost:3000` as-is.

> Either format works — the new `sb_publishable_*` / `sb_secret_*` keys printed by `supabase start` are accepted by all Supabase SDKs. The JWT form (`eyJ...`) is what existing docs and prod env vars use, so we standardize on it.

### 4. Run the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should be redirected to `/login` and see the **使用 Google 登录** button + the **邮件链接** / **密码登录** toggle, with no errors in the terminal. (If you see `@supabase/ssr: Your project's URL and API key are required`, your `.env.local` isn't right — re-do step 3.)

### 5. Sign in

There's no Google OAuth locally (it requires per-developer setup we don't want everyone going through). Use one of these instead.

#### Option A — magic link (no setup, recommended for first login)

You don't need to pre-create an account. Supabase's local Auth will create one on the fly the first time you request a magic link.

1. Open [http://localhost:3000/login](http://localhost:3000/login).
2. Make sure the **邮件链接** tab is selected (it's the default).
3. Type any address — `me@local.test`, `you@example.com`, anything. It doesn't have to be real, since nothing leaves your laptop.
4. Click **发送登录链接**.
5. Open [http://127.0.0.1:54324](http://127.0.0.1:54324) (Mailpit, the local mail catcher). The latest message will be **Your Magic Link**.
6. Click **Log In** in that email — you're signed in.

> Mailpit keeps every email you send through the local stack. If you want to test the magic link expiry flow, you can also copy the 6-digit code from the message body and enter it manually.

#### Option B — seeded test accounts (for multi-user scenarios)

If you want to test joins / +1 / waitlist with multiple users at once, seed the pre-defined accounts in [tests/test-users.ts](../tests/test-users.ts):

```bash
npm run seed:users
```

This creates ~20 pre-confirmed accounts. They all log in via the **密码登录** tab using the password `Vegdog123!` (the `TEST_PASSWORD` constant in that file).

Requires `.env.local` to be set up first — the script reads `SUPABASE_SERVICE_ROLE_KEY` from it to create users via the admin API.

### Common commands

| Task                                  | Command                       |
|---------------------------------------|-------------------------------|
| Reset the DB (re-apply schema + drop all data) | `supabase db reset`           |
| Stop the stack (preserves data)       | `supabase stop`               |
| Stop and wipe local data              | `supabase stop --no-backup`   |
| Inspect data in a web UI              | open [http://127.0.0.1:54323](http://127.0.0.1:54323) |
| Read local emails (magic links, etc.) | open [http://127.0.0.1:54324](http://127.0.0.1:54324) |
| View printed credentials again        | `supabase status`             |

### Troubleshooting

**`Cannot find module 'next'` or similar.** You forgot `npm install`.

**`@supabase/ssr: Your project's URL and API key are required`.** `.env.local` is missing or has placeholder values. Re-do step 3.

**`port 54321 is already allocated`.** Something is holding the port — either an earlier `supabase start` you forgot about, or another project's stack. Run `supabase stop` in this repo, or run `docker ps` and stop the conflicting container.

**`docker: Cannot connect to the Docker daemon`.** Docker Desktop isn't running, or it's launching and the daemon isn't up yet. Open Docker Desktop and wait until `docker info` succeeds (~10–15 seconds after the app starts).

**`toomanyrequests: Rate exceeded` during `supabase start`.** Docker Hub anonymous rate limit. The CLI auto-retries; just wait. If it keeps failing, sign in with `docker login` to get a higher quota.

**`supabase start` says "Stopped services: [supabase_imgproxy_… supabase_pooler_…]".** Not an error — those services are optional and disabled by default in `config.toml`. Ignore.

**The app loads but realtime updates don't fire.** Check that the relevant tables (`participants`, `payment_records`, `participant_renames`) are in the `supabase_realtime` publication — they are by default, but `supabase db reset` will fix this if something got out of sync.

**Email features don't send anything.** Expected. All email routes short-circuit unless `ENABLE_EMAIL=true` is set in `.env.local`. See the optional section in `.env.local.example`.

---

## Updating the schema

Right now `supabase/schema.sql` is the single source of truth — it's applied as seed SQL by both `supabase db reset` (local) and pasted into the SQL Editor of the hosted Supabase projects (prod/dev).

When you change the schema:

1. Edit `supabase/schema.sql`.
2. Run `supabase db reset` to apply locally and verify.
3. To roll out to the hosted prod/dev projects: open the Supabase dashboard → SQL Editor → paste the relevant change (not the whole file, since the hosted DB already has data).

If we start having a lot of schema changes, we should switch to proper migrations (`supabase migration new <name>`); for now schema.sql + targeted SQL Editor diffs is fine.

---

## E2E tests

Tests use [Playwright](https://playwright.dev/) and cover the core session lifecycle: create, join, +1, withdraw, waitlist, lock, 加时, payment.

**Setup:**

1. Make sure `supabase start` is running and `npm run dev` is up.
2. Seed test users: `npm run seed:users`.
3. Pick one as your "primary" test account and add it to `.env.local`:

   ```
   TEST_USER_EMAIL=test@example.com
   TEST_USER_PASSWORD=your-test-password
   ```

**Run:**

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # Playwright UI (recommended first time)
```

---

## Branching strategy

| Branch    | Deploys to        | DB              |
|-----------|-------------------|-----------------|
| `main`    | Production        | prod Supabase   |
| `develop` | Vercel preview    | dev Supabase    |
| `feature/*` (local) | nothing | your local stack |

Merge `develop` → `main` via PR to ship to production.

---

## Deploying a hosted environment

> You only need this section if you're standing up a new prod or dev environment. Day-to-day development never touches hosted Supabase.

The original prod + dev environments were set up by the founder. Repeat these steps to create a new one.

### 1. Deploy to Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new).
2. Choose a region close to your users (e.g. `us-west-1` for US West Coast).
3. Skip env vars for now — we'll add them after Supabase is set up.
4. Deploy. Note your app URL: `https://your-app.vercel.app`.

### 2. Create the Supabase project

1. Create a new project at [supabase.com](https://supabase.com).
2. Choose the **same region** as your Vercel deployment.
3. Open the SQL Editor and paste in the full contents of [`supabase/schema.sql`](../supabase/schema.sql). Run it.

Collect these values from **Settings → API**:

| Variable                          | Where to find it           |
|-----------------------------------|----------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`        | Project URL                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | `anon` `public` key        |
| `SUPABASE_SERVICE_ROLE_KEY`       | `service_role` key         |

### 3. Set up Google OAuth (optional, only if you want Google sign-in)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials.
2. Create an OAuth 2.0 client (Web application type).
3. Under **Authorized redirect URIs**, add:
   ```
   https://<your-supabase-ref>.supabase.co/auth/v1/callback
   ```
4. Save. In Supabase: **Authentication → Providers → Google** → paste Client ID and Client Secret.

> OAuth changes can take a few hours to propagate. Magic link works immediately.

### 4. Configure Supabase URL settings

In Supabase: **Authentication → URL Configuration**.

| Field        | Value                                                                                | Why                                                  |
|--------------|--------------------------------------------------------------------------------------|------------------------------------------------------|
| Site URL     | `https://your-app.vercel.app`                                                        | Where users land after magic link / OAuth login.     |
| Redirect URLs | `https://your-app.vercel.app/**` and `http://localhost:3000/**`                     | Allows any path on your app as a redirect target.    |

### 5. Set Vercel environment variables

Vercel → Settings → Environment Variables:

| Variable                          | Value                            | Environment      |
|-----------------------------------|----------------------------------|------------------|
| `NEXT_PUBLIC_SUPABASE_URL`        | from step 2                      | Production       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | from step 2                      | Production       |
| `SUPABASE_SERVICE_ROLE_KEY`       | from step 2                      | Production       |
| `NEXT_PUBLIC_SITE_URL`            | `https://your-app.vercel.app`    | Production       |
| `ENABLE_EMAIL`                    | `true` (only if you want email)  | Production       |
| `GMAIL_USER`                      | a Gmail address                  | Production       |
| `GMAIL_APP_PASSWORD`              | [App password][gmail-app-pw]     | Production       |
| `COURT_EMAIL`                     | court's email (comma-sep ok)     | Production       |

[gmail-app-pw]: https://myaccount.google.com/apppasswords

For a `develop` / preview environment: repeat steps 2–5 with a second Supabase project, and set those env vars under **Preview + Development** (not Production).

### 6. Redeploy

After setting env vars, trigger a redeploy so the build picks them up.

### Keeping the dev Supabase project alive

The Supabase free tier pauses projects after a week of inactivity. A daily cron at `/api/ping` (defined in [`vercel.json`](../vercel.json)) keeps the dev DB warm automatically.
