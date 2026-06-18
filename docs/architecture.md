# 菜狗 Architecture Guide

> **Who this is for:** Someone fluent in Python/ML/data but new to web apps, APIs, and databases. Concepts are explained from scratch with analogies to things you already know.

---

## Table of Contents

1. [Mental Model: Web App vs ML Pipeline](#1-mental-model-web-app-vs-ml-pipeline)
2. [Tech Stack](#2-tech-stack)
3. [Next.js: Server vs Client Components](#3-nextjs-server-vs-client-components)
4. [Data Model (Database Tables)](#4-data-model-database-tables)
5. [Auth: Who Are You?](#5-auth-who-are-you)
6. [Row-Level Security: Who Can Touch What?](#6-row-level-security-who-can-touch-what)
7. [Key User Flows](#7-key-user-flows)
8. [Realtime: Live Updates Without Refreshing](#8-realtime-live-updates-without-refreshing)
9. [Concurrency: The Race Condition Problem](#9-concurrency-the-race-condition-problem)
10. [API Routes](#10-api-routes)
11. [File Map](#11-file-map)

---

## 1. Mental Model: Web App vs ML Pipeline

In ML, a pipeline looks like:

```
raw data → preprocessing → model → prediction
```

Each step is a Python function. You run it once, get output.

A web app is different — it's **reactive and stateful**:

```
User action → request → server logic → DB read/write → response → UI update
                ↑                                                       │
                └───────────────── next action ─────────────────────────┘
```

And multiple users are doing this simultaneously, all sharing the same database.

The three physical systems in this app:

```
[ Browser ]  ──HTTP/WebSocket──►  [ Vercel (Next.js) ]  ──HTTPS──►  [ Supabase ]
  Renders UI                        Builds HTML pages                 PostgreSQL DB
  Handles clicks                    Runs server logic                 Auth system
  Manages state                     Calls Supabase                    RLS enforcement
```

**What happens on a page load (e.g., `/sessions/abc123`):**
1. Your browser sends `GET /sessions/abc123` to Vercel
2. Next.js server runs, queries Supabase for session data
3. Next.js builds HTML with the data embedded and sends it to your browser
4. Browser renders the page — you see it
5. Browser opens a WebSocket connection to Supabase for live updates

**What happens when you click "加入":**
1. Browser calls a Supabase RPC function (`join_session`) with your auth token
2. Supabase checks if you're allowed (RLS)
3. Supabase runs the function (with a lock to prevent race conditions)
4. All other browsers watching the same session get notified via WebSocket
5. Their UIs update to show your name

---

## 2. Tech Stack

| Layer | Technology | Analogy |
|-------|-----------|---------|
| **UI Framework** | Next.js 15 | Like a Flask app, but renders HTML both on server and in browser |
| **Styling** | Tailwind CSS | Utility classes — `className="text-sm font-bold"` instead of separate CSS files |
| **Language** | TypeScript | Python with type hints, but enforced at compile time |
| **Database** | PostgreSQL (via Supabase) | Like pandas DataFrames, but persistent, relational, and multi-user |
| **Auth** | Supabase Auth | Like `flask-login`, but hosted — handles tokens, cookies, OAuth |
| **Realtime** | Supabase Realtime | Like a pub/sub system — DB changes broadcast to all subscribers |
| **Hosting** | Vercel | Like AWS Lambda — serverless, scales automatically, deploys on git push |
| **Email** | Nodemailer + Gmail | Like `smtplib` in Python |

**What is Supabase?**

Supabase is a hosted backend. Instead of running your own PostgreSQL server + auth system + API layer, you use theirs. It auto-generates a REST API from your tables, enforces access control inside the DB (RLS), and provides a JavaScript client library (`@supabase/supabase-js`) that talks to all of this.

Think of it as: NumPy + scikit-learn already installed and hosted for you, so you don't have to set up a Python environment.

---

## 3. Next.js: Server vs Client Components

This is one of the most confusing parts of modern React. There are two types of components:

### Server Components (default)

- Run **only on Vercel's server**, never in the browser
- Can `await` database calls directly (like a regular Python function)
- Cannot use browser APIs (`window`, `document`) or React state (`useState`)
- Result: HTML sent to the browser — fast first load, good for SEO

```typescript
// This runs on the server. It can query Supabase directly.
export default async function SessionsPage() {
  const supabase = await createClient()           // server-side Supabase client
  const { data: sessions } = await supabase       // direct DB query
    .from('sessions').select('*')
  return <div>{sessions.map(s => <SessionCard s={s} />)}</div>
}
```

### Client Components (marked with `'use client'`)

- Run **in the browser** after the page loads
- Can use state, effects, event handlers (`onClick`, etc.)
- Cannot directly call server-only code
- Talk to Supabase via the browser Supabase client (using cookies for auth)

```typescript
'use client'
// This runs in the browser. It manages interactive state.
export default function SessionDetailClient({ session }) {
  const [participants, setParticipants] = useState([])
  
  async function handleJoin() {
    await supabase.rpc('join_session', { ... })   // browser → Supabase directly
    refreshParticipants()
  }
  
  return <button onClick={handleJoin}>加入</button>
}
```

### How they work together

A common pattern in this app:

```
page.tsx (Server Component)
    │
    ├─ Fetches initial data from Supabase on the server
    └─ Passes data as props to SessionDetailClient.tsx (Client Component)
            │
            └─ Handles all interactions (join, withdraw, pay, etc.)
               Talks to Supabase directly from the browser
```

This gives you fast initial load (server renders the page with data) plus full interactivity (client handles all the clicks).

---

## 4. Data Model (Database Tables)

Tables are like pandas DataFrames — rows and columns. The difference: they're persistent, relational (they reference each other via IDs), and concurrent (thousands of people can read/write simultaneously).

### Entity Relationship Diagram

```
auth.users  (Supabase built-in — one row per login)
    │ 1:1
    ▼
profiles  ──────────────────────────────────────────┐
    │ 1:many                                         │ (follower/following)
    ▼                                                ▼
sessions ──── session_admins ──── profiles         follows
    │ 1:many
    ├──► participants ──── payment_records (1:1)
    │        │ many:1
    │        ▼
    │      profiles
    │
    └──► payment_methods
```

---

### `profiles`
One row per user. Auto-created by a DB trigger when someone signs up.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Same as `auth.users.id` — the primary key |
| `nickname` | text | Display name shown in the queue |
| `avatar_url` | text | URL to profile photo; falls back to DiceBear auto-generated avatar |
| `venmo_username` | text | Used to build Venmo payment deep links |
| `created_at` | timestamptz | Signup time |
| `updated_at` | timestamptz | Last profile edit |

---

### `sessions`
One row per badminton event.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `title` | text | e.g., "周三菜狗" |
| `location` | text | Venue name |
| `location_address` | text | Full address (shown as a copyable string) |
| `notes` | text | Free-text info shown to all participants |
| `starts_at` | timestamptz | Event start time (UTC) |
| `withdraw_deadline` | timestamptz | After this → withdrawal is "late" |
| `max_participants` | int | Capacity; beyond this → waitlist |
| `court_count` | int | Number of courts booked |
| `fee_per_person` | decimal | Cost per player (optional) |
| `late_withdraw_ratio` | decimal | Fee multiplier for late exit (e.g., `0.5` = 50%) |
| `status` | text | `open` → `locked` → `closed` (or `canceled`) |
| `initiator_id` | UUID | FK → `profiles.id` |
| `created_at` | timestamptz | |

**Status lifecycle:**
```
open  ──(admin locks)──►  locked  ──(admin closes)──►  closed
  └──(admin cancels)──►  canceled
```
- `open`: Accepts joins and withdrawals
- `locked`: Queue frozen; payment tracking begins
- `closed`: Read-only, shown in history
- `canceled`: Event called off

---

### `participants`
One row per "slot" in a session. A user can have multiple rows in one session (e.g., bringing a guest creates a second slot under their account with a different `display_name`).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `session_id` | UUID | FK → `sessions.id` |
| `user_id` | UUID | FK → `profiles.id` — the account holder |
| `display_name` | text | Name shown in the queue (may differ from nickname for +1s) |
| `queue_position` | int | Insertion order; used to promote waitlisted players in order |
| `status` | text | `joined` / `waitlist` / `withdrawn` / `late_withdraw` |
| `stayed_late` | boolean | Admin marks if this person stayed for overtime |
| `joined_at` | timestamptz | |
| `withdrew_at` | timestamptz | Null if still active |

**Status meanings:**
```
joined        → active, counts toward max_participants
waitlist      → queued; auto-promoted when a joined player leaves
withdrawn     → left before deadline (no penalty)
late_withdraw → left after deadline (may owe a fee)
```

---

### `session_admins`
Tracks who has admin rights for a session. The initiator is automatically inserted here when a session is created (via DB trigger). Additional admins can be added manually.

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | UUID | FK → `sessions.id` |
| `user_id` | UUID | FK → `profiles.id` |
| `created_at` | timestamptz | |

Primary key is `(session_id, user_id)` — a user can only be admin of a session once.

---

### `payment_methods`
One row per payee added by the admin (e.g., "Pay Alice $18 on Venmo").

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `session_id` | UUID | FK → `sessions.id` |
| `type` | text | `venmo` / `zelle` / `other` |
| `label` | text | Payee display name (e.g., "Alice") |
| `account_ref` | text | Venmo handle without @ |
| `amount` | decimal | Per-person amount |
| `created_by` | UUID | FK → `profiles.id` |
| `created_at` | timestamptz | |

---

### `payment_records`
One row per participant in a locked session. Auto-created by a DB trigger when a session is locked. Tracks who has paid.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `session_id` | UUID | FK → `sessions.id` |
| `participant_id` | UUID | FK → `participants.id` — unique constraint (one record per slot) |
| `status` | text | `unpaid` / `paid` / `waived` |
| `note` | text | Optional admin note |
| `updated_at` | timestamptz | |

Records are **immutable in identity** — once created, the participant association never changes. Only `status` and `note` are updated.

---

### `follows`
Tracks who follows whom. When user A follows user B, and B creates a new session, A gets an email notification — unless A has turned it off (see below).

**Email notification preferences.** Each `profiles` row carries four opt-out flags (all `boolean not null default true`): `notify_follow` (关注的人发起新接龙), `notify_promoted` (候补递补成功), `notify_match_recorded` (对局待确认), `notify_match_published` (对局发布). Users toggle these on the 设置 → 账户 page. The corresponding `/api/notify-*` routes filter recipients by the matching flag before sending, so opting out suppresses that email. New columns ship in `supabase/migrations_notify_prefs.sql`.

| Column | Type | Notes |
|--------|------|-------|
| `follower_id` | UUID | FK → `profiles.id` — the person following |
| `following_id` | UUID | FK → `profiles.id` — the person being followed |
| `created_at` | timestamptz | |

Primary key is `(follower_id, following_id)`.

---

## 5. Auth: Who Are You?

### Login Methods

| Method | Flow |
|--------|------|
| **Google OAuth** | Browser → Google login page → Google redirects to Supabase callback → Supabase sets cookie → app |
| **Magic Link** | Enter email → Supabase sends a one-time link → click it → Supabase sets cookie → app |
| **Email + Password** | Classic; Supabase validates credentials and sets cookie |

### What "logged in" means technically

After login, Supabase stores a **JWT token** in a browser cookie. A JWT is a base64-encoded string like:

```
eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLXV1aWQiLCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.signature
```

Decoded, it contains: your user UUID, your role (`authenticated`), and an expiry time. Supabase cryptographically signs it so it can't be forged.

Every request your browser makes to Supabase includes this token in a header. Supabase verifies the signature and extracts `auth.uid()` (your UUID). RLS policies use this to decide what you can access.

**Analogy:** It's like a signed receipt from a restaurant. The receipt says "Yang, table 5, paid $20." The cashier (Supabase) can verify it's genuine (signature check) without looking up your account every time.

### Route Protection

`src/middleware.ts` runs on every page request **before** Next.js renders anything. It reads your cookie, validates your token with Supabase, and:

- If token **valid** → continue to the page
- If token **missing or expired** and page requires login → redirect to `/login?next=/original-path`

After login, you're sent back to the page you tried to visit.

### New User Auto-Provisioning

When someone signs up for the first time (Google OAuth or email), Supabase creates a row in `auth.users`. A **PostgreSQL trigger** (`on_auth_user_created`) immediately fires and inserts a corresponding row in `public.profiles` with:
- Nickname from Google full name (or email prefix as fallback)
- Avatar from Google profile photo (or DiceBear auto-generated from UUID as fallback)

This means the app never has to manually create profile rows — the DB handles it.

---

## 6. Row-Level Security: Who Can Touch What?

RLS is access control implemented **inside the database itself**. Every table has policies — SQL expressions evaluated per row, per operation. Even if your frontend code has a bug that skips a permission check, RLS ensures the DB rejects unauthorized queries.

Think of it like `.filter()` applied to every query automatically. If you query `SELECT * FROM participants`, PostgreSQL silently adds `WHERE <rls_policy_condition>` before executing.

### How policies work

```sql
-- Example: "you can only update your own profile"
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
```

`auth.uid()` is the UUID extracted from your JWT token. `id` is the profile row's primary key. If they don't match, the update is rejected.

### Policy summary

**`profiles`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Anyone | Always allowed (public profiles) |
| INSERT | Yourself only | `auth.uid() = id` |
| UPDATE | Yourself only | `auth.uid() = id` |

**`sessions`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Anyone | Always allowed |
| INSERT | Any logged-in user | `auth.uid() = initiator_id` |
| UPDATE | Session admins only | Caller must exist in `session_admins` for this session |

**`participants`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Anyone | Always allowed (queue is public) |
| INSERT | Any logged-in user | `auth.uid() = user_id` |
| UPDATE | Yourself OR session admins | `auth.uid() = user_id` OR exists in `session_admins` |

**`payment_methods`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Anyone | Always allowed |
| INSERT / UPDATE / DELETE | Session admins only | Caller must exist in `session_admins` |

**`payment_records`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Any logged-in user | Must be authenticated |
| INSERT / UPDATE | Yourself only | Your participant row must belong to you |

**`follows`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Any logged-in user | Must be authenticated |
| INSERT | Yourself only | `auth.uid() = follower_id` |
| DELETE | Yourself only | `auth.uid() = follower_id` |

**`session_admins`**
| Operation | Who | Condition |
|-----------|-----|-----------|
| SELECT | Any logged-in user | Must be authenticated |
| INSERT | Existing admins only | Caller must already be in `session_admins` for this session |
| DELETE | Existing admins only | Caller must be admin AND target cannot be the session initiator |

### RPC functions bypass RLS

The `join_session` and `withdraw_participant` functions are defined with `SECURITY DEFINER`, meaning they run with elevated DB privileges (like a `sudo` call). This is necessary because they need to perform multiple operations atomically (check count → insert → maybe promote waitlist) without RLS interfering mid-operation. The functions themselves contain their own authorization checks.

---

## 7. Key User Flows

### Join a Session

```
User clicks "加入"
    │
    ├─ Optimistic UI: name appears in list immediately (with temporary local ID)
    │                  (makes the app feel instant even before the server responds)
    │
    └─ Browser calls: supabase.rpc('join_session', { session_id, user_id, display_name })
              │
              ├─ pg_advisory_xact_lock(session_id)   ← database mutex, prevents race conditions
              ├─ SELECT session → verify status = 'open'
              ├─ SELECT participants → check no duplicate name for this user
              ├─ SELECT COUNT(*) WHERE status = 'joined'
              │
              ├─ if count < max_participants:
              │       INSERT participant(status='joined')
              └─ else:
                      INSERT participant(status='waitlist')

    Browser: replace temp entry with real DB row (real UUID)
    Other browsers: receive WebSocket event → re-render queue
```

### Withdraw

```
User clicks "退出" on their entry
    │
    ├─ Optimistic UI: entry removed immediately
    │
    └─ Browser calls: supabase.rpc('withdraw_participant', { participant_id, user_id })
              │
              ├─ SELECT participant → verify user_id matches caller
              ├─ SELECT session → get withdraw_deadline
              │
              ├─ if now() > withdraw_deadline:
              │       UPDATE participant SET status = 'late_withdraw'
              └─ else:
                      UPDATE participant SET status = 'withdrawn'

              Auto-promotion:
                  if a waitlisted player exists AND joined count < max:
                      UPDATE the lowest queue_position waitlisted player → 'joined'

    Other browsers: WebSocket event → queue re-renders with promoted player
```

### Lock Session (Admin Only)

```
Admin clicks "🔒 锁定接龙"
    │
    ├─ UPDATE sessions SET status = 'locked'
    │
    └─ PostgreSQL trigger fires (on_session_locked):
              │
              └─ For each participant WHERE status = 'joined' AND no payment_record yet:
                      INSERT payment_records(status='unpaid')

    Join/withdraw buttons disappear (UI checks status)
    Admin can now add payment_methods
    Participants can self-report payment status
```

### Pay via Venmo Deep Link

```
User clicks "Venmo 付款" button
    │
    ├─ App builds deep link URL:
    │       venmo://paycharge?txn=pay&recipients=HANDLE&amount=X&note=菜狗 @NICKNAME
    │
    ├─ Sets window.location.href = venmo:// URL
    │       → if Venmo app installed: app opens with pre-filled form
    │
    └─ After 1.5s timeout (fallback):
            window.open('https://venmo.com/HANDLE', '_blank')
            → opens Venmo web if app not installed
```

### Follower Email Notification

```
Admin creates a new session
    │
    └─ After INSERT into sessions succeeds (client-side):
              │
              └─ Browser calls: POST /api/notify-followers
                        │
                        ├─ Uses service role key (bypasses RLS) to query:
                        │       SELECT follower_id FROM follows WHERE following_id = initiator_id
                        │
                        ├─ For each follower: look up their email from auth.users
                        │
                        └─ Send email via Nodemailer + Gmail SMTP:
                                "Your friend just created a new badminton session!"
```

---

## 8. Realtime: Live Updates Without Refreshing

When you open a session detail page, the browser opens a **WebSocket** connection to Supabase. A WebSocket is a persistent two-way connection (unlike HTTP which is request→response→close). It stays open while you're on the page.

**Analogy:** HTTP is like sending a text and waiting for a reply. WebSocket is like a phone call that stays open — the other side can speak at any time.

Supabase Realtime listens to PostgreSQL's write-ahead log (WAL) — a stream of every DB change — and broadcasts matching changes to subscribed clients.

**What the session page subscribes to:**

```typescript
supabase
  .channel(`session-${sessionId}`)
  .on('postgres_changes', {
    event: '*',                          // INSERT, UPDATE, DELETE
    schema: 'public',
    table: 'participants',
    filter: `session_id=eq.${sessionId}`
  }, () => refreshParticipants())        // re-fetch participants from DB
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'payment_records',
    filter: `session_id=eq.${sessionId}`
  }, () => refreshPayRecords())          // re-fetch payment records
  .subscribe()
```

When anyone joins, withdraws, or marks a payment, **all other browsers on that page** get notified within ~1 second and re-render.

The subscription is cleaned up when you navigate away (`useEffect` cleanup function).

---

## 9. Concurrency: The Race Condition Problem

This is a classic distributed systems problem. Imagine 10 users try to join the last available spot simultaneously:

**Without protection:**
1. All 10 query: "is there a free slot?" → all see 1 slot available (queries run in parallel)
2. All 10 insert: "I'm joining!" → 10 rows inserted into a 1-slot vacancy
3. Session is now 9 over capacity

**Analogy in Python:** imagine 10 threads all running `if counter < max: counter += 1` at the same time — without a lock, you get race conditions.

**Solution: PostgreSQL Advisory Locks**

The `join_session` RPC function starts with:

```sql
perform pg_advisory_xact_lock(abs(hashtext(p_session_id::text)));
```

This acquires an **exclusive lock keyed to the session ID**. Only one transaction can hold this lock at a time. Others wait in a queue.

```
10 users call join_session(session_abc) simultaneously
    │
    ├─ User A acquires lock → checks count (1 slot) → inserts 'joined' → releases lock
    ├─ User B acquires lock → checks count (0 slots) → inserts 'waitlist' → releases lock
    ├─ User C acquires lock → checks count (0 slots) → inserts 'waitlist' → releases lock
    └─ ... (remaining 7 all go to waitlist)
```

Result: exactly one person gets the last `joined` slot. No double-booking. The lock is transaction-scoped — it releases automatically when the function returns.

---

## 10. API Routes

Next.js API routes are serverless functions that run on Vercel (not in the browser). They're used for operations that need server-side secrets or can't be done directly from the browser.

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/notify-followers` | POST | Sends email to followers when a new session is created. Uses `SUPABASE_SERVICE_ROLE_KEY` to read `auth.users` emails (not accessible from browser) |
| `/api/notify-match-confirmation` | POST | Emails the registered opponents/teammate of a 对战 (match) to confirm a result. Opt-in: the recorder must tick "发送邮件通知参与方" (default off) on the match page; only then does the client call this route. See `docs/versus-design.md` |
| `/api/notify-match-published` | POST | Emails all registered participants when the final confirmation publishes a match. Fired by the confirming client when `confirm_match` returns `status='published'`. Gated by `ENABLE_EMAIL`. |
| `/api/send-court-email` | POST | Sends the session roster to the court's email address |
| `/api/ping` | GET | Lightweight DB query to keep the free-tier Supabase project from pausing due to inactivity (called by Vercel cron daily) |

**Why can't these be done from the browser?**

The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS policies — it can read anything, including private auth data like user emails. It must never be sent to the browser (it would be visible to anyone). API routes run on the server, so they can use it safely.

---

## 11. File Map

```
src/
├── app/
│   ├── (tabs)/                        # Tab-navigated pages (shared bottom nav)
│   │   ├── sessions/page.tsx          # Server component: active sessions list
│   │   ├── history/page.tsx           # Server component: past sessions
│   │   ├── versus/                    # 对战 tab: 对局 / 对战历史 / 菜狗杯 sub-views
│   │   └── settings/
│   │       ├── page.tsx               # Server component: reads CHANGELOG.md at build time
│   │       └── SettingsClient.tsx     # Client component: all interactive settings logic
│   │
│   ├── sessions/
│   │   ├── [id]/
│   │   │   ├── page.tsx               # Server component: fetches session + participants
│   │   │   └── SessionDetailClient.tsx # Client component: join/withdraw/lock/pay/etc.
│   │   └── new/page.tsx               # Client component: create session form
│   │
│   ├── versus/
│   │   ├── [id]/                      # Match detail: score entry, confirm flow, visibility toggle, realtime
│   │   └── new/page.tsx               # Create-match form (singles/doubles, member pickers)
│   │
│   ├── players/
│   │   └── [id]/page.tsx              # Player profile: public published matches + win/loss record
│   │
│   ├── login/page.tsx                 # Client component: Google/magic link/password login
│   ├── auth/callback/route.ts         # OAuth redirect handler (exchanges code for session)
│   │
│   └── api/
│       ├── notify-followers/route.ts  # Sends follower email notifications
│       ├── notify-match-confirmation/route.ts # Emails match participants to confirm a result (recorder opt-in)
│       ├── notify-match-published/route.ts # Emails all participants when a match is published
│       ├── send-court-email/route.ts  # Sends roster to court
│       └── ping/route.ts             # DB keep-alive for free-tier Supabase
│
├── components/
│   ├── Navbar.tsx                     # Server component: top nav with avatar
│   ├── NavbarActions.tsx              # Client component: logout button
│   ├── BottomNav.tsx                  # Client component: tab bar (sessions/history/versus/...)
│   ├── MemberPicker.tsx              # Nickname-search member picker (+ guest force-input)
│   └── SessionCard.tsx                # Server component: session summary card
│
├── lib/
│   ├── types.ts                       # TypeScript interfaces for all DB tables
│   ├── dates.ts                       # Date formatting utilities
│   ├── match.ts                       # 对战 result helpers (games won, winner, score line)
│   ├── locations.ts                   # Preset venue list
│   └── supabase/
│       ├── client.ts                  # Browser Supabase client (reads auth from cookies)
│       └── server.ts                  # Server Supabase client (reads auth from cookies server-side)
│
└── middleware.ts                      # Auth guard: redirects unauthenticated users to /login

supabase/
├── schema.sql                         # All tables, RLS policies, triggers, functions — single source of truth
├── migrations_versus.sql              # 对战 feature migration to run on the existing live DB
└── patches.sql                        # Retired (all patches merged into schema.sql)

docs/
├── architecture.md                    # This file
├── versus-design.md                   # 对战 (match) feature design + Phase 2 rating plan
└── development.md                     # Setup guide for new environments

vercel.json                            # Cron job config (daily ping)
CHANGELOG.md                           # Version history (parsed and displayed in the app's 关于 tab)
```

---

## Key Design Decisions

**Why server components for list pages?**
The sessions list (`/sessions`) and history (`/history`) are server components with `revalidate = 0` (no caching). This means every page load fetches fresh data from Supabase. There's no stale cache to worry about, at the cost of a slightly slower initial load.

**Why client component for session detail?**
The session detail page needs realtime updates (WebSocket), optimistic UI (instant feedback before DB confirms), and complex interaction state. All of this requires running in the browser, so it's a client component.

**Why RPC functions for join/withdraw?**
These operations need to be atomic — check count, insert row, maybe promote waitlist — all in one transaction with a lock. Doing this as three separate Supabase calls from the browser would have race conditions between calls. Packaging it into a PostgreSQL function ensures it all happens in one locked transaction.

**Why store payment records in the DB instead of just marking in UI?**
Payment status is shared between multiple admins and the participant themselves. It needs to be the same for everyone viewing the session. Keeping it in the DB (with Realtime sync) ensures consistency.
