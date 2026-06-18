-- ============================================================
-- 站内信 (NOTIFICATIONS — Phase 2) migration
-- Run on the EXISTING live Supabase project (dev first, then prod).
-- For a fresh project, schema.sql §8c already contains all of this.
--
-- Run-once for the table/policies/realtime; the two functions are
-- CREATE OR REPLACE (safe to re-run).
-- Depends on the ratings migration (migrations_versus_phase2.sql) having run,
-- since confirm_match below also calls apply_match_rating.
-- ============================================================

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user   on public.notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on public.notifications(user_id) where not read;

alter publication supabase_realtime add table public.notifications;

alter table public.notifications enable row level security;
create policy "notifications_select_own" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_update_own" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── Add station-letter inserts to the two match RPCs ────────────────────────
create or replace function public.request_match_confirmation(p_match_id uuid)
returns public.matches
language plpgsql security definer as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if v_match.recorder_id != auth.uid() then raise exception 'Not your match'; end if;
  if v_match.status not in ('draft', 'pending') then raise exception 'Cannot request confirmation'; end if;

  if not exists (select 1 from public.match_games where match_id = p_match_id) then
    raise exception 'Record at least one game first';
  end if;
  if not exists (
    select 1 from public.match_participants
    where match_id = p_match_id and not is_recorder and not is_guest
  ) then
    raise exception 'Need at least one registered opponent to confirm the result';
  end if;

  update public.match_participants
     set confirmed = false, confirmed_at = null
   where match_id = p_match_id and not is_recorder and not is_guest;

  update public.matches set status = 'pending' where id = p_match_id returning * into v_match;

  insert into public.notifications (user_id, type, title, body, link)
  select mp.user_id, 'match_confirm', '有对局待你确认',
         coalesce(rec.nickname, '有人') || ' 录入了一场对局，请确认结果', '/versus'
  from public.match_participants mp
  left join public.profiles rec on rec.id = v_match.recorder_id
  where mp.match_id = p_match_id and not mp.is_recorder and not mp.is_guest;

  return v_match;
end;
$$;

create or replace function public.confirm_match(p_match_id uuid)
returns public.matches
language plpgsql security definer as $$
declare
  v_match    public.matches;
  v_pending  int;
begin
  perform pg_advisory_xact_lock(abs(hashtext(p_match_id::text)));

  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if v_match.status != 'pending' then raise exception 'Match is not awaiting confirmation'; end if;

  update public.match_participants
     set confirmed = true, confirmed_at = now()
   where match_id = p_match_id and user_id = auth.uid()
     and not is_recorder and not is_guest and not confirmed;
  if not found then raise exception 'You are not a pending confirmer for this match'; end if;

  select count(*) into v_pending
    from public.match_participants
   where match_id = p_match_id and not is_recorder and not is_guest and not confirmed;

  if v_pending = 0 then
    update public.matches
       set status = 'published', published_at = now()
     where id = p_match_id
     returning * into v_match;
    perform public.apply_match_rating(p_match_id);

    insert into public.notifications (user_id, type, title, body, link)
    select mp.user_id, 'match_published', '对局已发布',
           '你参与的一场对局已全员确认并发布', '/versus/' || p_match_id
    from public.match_participants mp
    where mp.match_id = p_match_id and not mp.is_guest and mp.user_id is not null;
  else
    select * into v_match from public.matches where id = p_match_id;
  end if;

  return v_match;
end;
$$;
