-- ============================================================
-- Email notification preferences — run on the EXISTING live Supabase project.
-- Idempotent: safe to run multiple times.
-- For a fresh project, schema.sql already contains these columns.
-- ============================================================

alter table public.profiles
  add column if not exists notify_follow          boolean not null default true,
  add column if not exists notify_promoted        boolean not null default true,
  add column if not exists notify_match_recorded  boolean not null default true,
  add column if not exists notify_match_published boolean not null default true;
