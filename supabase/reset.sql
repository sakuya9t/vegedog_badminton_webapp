-- ⚠️  FULL RESET — drops all app tables, functions, triggers, and policies
-- Run this in Supabase SQL Editor, then run schema.sql afterwards.

-- Drop functions (cascade removes dependent triggers)
drop function if exists public.handle_new_user()                              cascade;
drop function if exists public.join_session(uuid, uuid, text)                 cascade;
drop function if exists public.withdraw_participant(uuid, uuid)               cascade;
drop function if exists public.rename_participant(uuid, text)                 cascade;
drop function if exists public.update_session_capacity(uuid, int)             cascade;
drop function if exists public.initialize_payment_records()                   cascade;
drop function if exists public.add_initiator_as_admin()                       cascade;

-- Drop tables (cascade removes policies, indexes, foreign keys)
drop table if exists public.session_admins      cascade;
drop table if exists public.follows             cascade;
drop table if exists public.participant_renames cascade;
drop table if exists public.payment_records     cascade;
drop table if exists public.payment_methods     cascade;
drop table if exists public.participants        cascade;
drop table if exists public.sessions            cascade;
drop table if exists public.profiles            cascade;
