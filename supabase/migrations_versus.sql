-- ============================================================
-- 对战 (VERSUS) migration — run on the EXISTING live Supabase project.
-- Idempotent-ish: tables use plain CREATE (will error if already applied).
-- For a fresh project, schema.sql already contains this block.
-- ============================================================

-- A "match" is a set of games (局) between a FIXED set of players.
-- Lifecycle: draft (only recorder sees) → pending (confirmation requested,
-- email sent) → published (all registered non-recorder participants confirmed).
-- See docs/versus-design.md for the full design.

create table public.matches (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('singles', 'doubles')),
  recorder_id   uuid not null references public.profiles(id),
  status        text not null default 'draft'
                  check (status in ('draft', 'pending', 'published', 'canceled')),
  is_public     boolean not null default true,
  played_at     timestamptz not null default now(),
  note          text,
  created_at    timestamptz not null default now(),
  published_at  timestamptz
);

create table public.match_participants (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches(id) on delete cascade,
  user_id       uuid references public.profiles(id),          -- null for guests (+1)
  is_guest      boolean not null default false,
  team          smallint not null check (team in (1, 2)),     -- 1 = recorder's side
  is_recorder   boolean not null default false,
  confirmed     boolean not null default false,               -- recorder/guest slots start true
  confirmed_at  timestamptz,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- One registered profile cannot occupy two slots in the same match (guests exempt).
create unique index idx_match_participants_unique_user
  on public.match_participants(match_id, user_id)
  where user_id is not null;

create table public.match_games (
  id           uuid primary key default gen_random_uuid(),
  match_id     uuid not null references public.matches(id) on delete cascade,
  game_no      int not null,
  team1_score  int not null default 0,
  team2_score  int not null default 0,
  created_at   timestamptz not null default now(),
  unique (match_id, game_no)
);

create index if not exists idx_match_participants_match on public.match_participants(match_id);
create index if not exists idx_match_games_match        on public.match_games(match_id, game_no);
create index if not exists idx_matches_status           on public.matches(status, published_at desc);

-- ── RPC: create_match ───────────────────────────────────────────────────────
-- p_participants: jsonb array of { user_id (uuid|null), is_guest (bool),
--   team (1|2), is_recorder (bool), display_name (text) }
create or replace function public.create_match(
  p_type         text,
  p_is_public    boolean,
  p_played_at    timestamptz,
  p_participants jsonb,
  p_note         text default null
)
returns public.matches
language plpgsql security definer
as $$
declare
  v_match      public.matches;
  v_part       jsonb;
  v_expected   int;
  v_count      int;
  v_rec_count  int;
begin
  if p_type not in ('singles', 'doubles') then raise exception 'Invalid match type'; end if;
  v_expected := case when p_type = 'singles' then 2 else 4 end;

  v_count := jsonb_array_length(p_participants);
  if v_count != v_expected then
    raise exception 'Expected % participants for %, got %', v_expected, p_type, v_count;
  end if;

  -- Exactly one recorder slot, and it must be the caller.
  v_rec_count := 0;
  for v_part in select * from jsonb_array_elements(p_participants) loop
    if (v_part->>'is_recorder')::boolean then
      v_rec_count := v_rec_count + 1;
      if (v_part->>'user_id')::uuid is distinct from auth.uid() then
        raise exception 'Recorder slot must be the caller';
      end if;
    end if;
    -- Registered slots must reference a real profile.
    if not coalesce((v_part->>'is_guest')::boolean, false) then
      if (v_part->>'user_id')::uuid is null then raise exception 'Registered slot missing user_id'; end if;
      if not exists (select 1 from public.profiles where id = (v_part->>'user_id')::uuid) then
        raise exception 'Participant is not a registered member';
      end if;
    end if;
  end loop;
  if v_rec_count != 1 then raise exception 'Exactly one recorder slot required'; end if;

  insert into public.matches (type, recorder_id, status, is_public, played_at, note)
  values (p_type, auth.uid(), 'draft', coalesce(p_is_public, true), coalesce(p_played_at, now()), p_note)
  returning * into v_match;

  insert into public.match_participants
    (match_id, user_id, is_guest, team, is_recorder, confirmed, confirmed_at, display_name)
  select
    v_match.id,
    (p->>'user_id')::uuid,
    coalesce((p->>'is_guest')::boolean, false),
    (p->>'team')::smallint,
    coalesce((p->>'is_recorder')::boolean, false),
    -- recorder and guest slots are auto-confirmed
    coalesce((p->>'is_recorder')::boolean, false) or coalesce((p->>'is_guest')::boolean, false),
    case when coalesce((p->>'is_recorder')::boolean, false) or coalesce((p->>'is_guest')::boolean, false)
         then now() else null end,
    p->>'display_name'
  from jsonb_array_elements(p_participants) p;

  return v_match;
end;
$$;

-- ── RPC: set_match_games ────────────────────────────────────────────────────
-- Replaces all games. In pending state, changing scores invalidates all
-- registered confirmations (the result changed).
create or replace function public.set_match_games(
  p_match_id uuid,
  p_games    jsonb
)
returns void language plpgsql security definer as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if v_match.recorder_id != auth.uid() then raise exception 'Not your match'; end if;
  if v_match.status not in ('draft', 'pending') then raise exception 'Match is not editable'; end if;

  delete from public.match_games where match_id = p_match_id;
  insert into public.match_games (match_id, game_no, team1_score, team2_score)
  select p_match_id,
         (g->>'game_no')::int,
         (g->>'team1_score')::int,
         (g->>'team2_score')::int
  from jsonb_array_elements(p_games) g;

  -- Result changed → everyone must re-confirm.
  if v_match.status = 'pending' then
    update public.match_participants
       set confirmed = false, confirmed_at = null
     where match_id = p_match_id and not is_recorder and not is_guest;
  end if;
end;
$$;

-- ── RPC: replace_match_participant ──────────────────────────────────────────
-- Swap a slot to a different registered member or to a guest. Resets only that
-- slot's confirmation. Cannot touch the recorder slot or a published match.
create or replace function public.replace_match_participant(
  p_participant_id uuid,
  p_new_user_id    uuid default null,
  p_guest_name     text default null
)
returns public.match_participants
language plpgsql security definer as $$
declare
  v_part  public.match_participants;
  v_match public.matches;
  v_guest boolean;
begin
  select * into v_part from public.match_participants where id = p_participant_id;
  if not found then raise exception 'Participant not found'; end if;

  select * into v_match from public.matches where id = v_part.match_id;
  if v_match.recorder_id != auth.uid() then raise exception 'Not your match'; end if;
  if v_match.status not in ('draft', 'pending') then raise exception 'Match is not editable'; end if;
  if v_part.is_recorder then raise exception 'Cannot replace the recorder slot'; end if;

  v_guest := p_new_user_id is null;
  if v_guest then
    if coalesce(btrim(p_guest_name), '') = '' then raise exception 'Guest name required'; end if;
  else
    if not exists (select 1 from public.profiles where id = p_new_user_id) then
      raise exception 'New participant is not a registered member';
    end if;
    if exists (
      select 1 from public.match_participants
      where match_id = v_part.match_id and user_id = p_new_user_id and id != p_participant_id
    ) then raise exception 'That member is already in this match'; end if;
  end if;

  update public.match_participants
     set user_id      = p_new_user_id,
         is_guest     = v_guest,
         display_name = case when v_guest then btrim(p_guest_name)
                             else (select nickname from public.profiles where id = p_new_user_id) end,
         confirmed    = v_guest,                         -- guest auto-confirmed; registered must re-confirm
         confirmed_at = case when v_guest then now() else null end
   where id = p_participant_id
   returning * into v_part;

  return v_part;
end;
$$;

-- ── RPC: set_match_privacy ──────────────────────────────────────────────────
-- Recorder toggles public/private. Allowed only while editable (draft/pending);
-- a published match's visibility is locked. In pending, changing visibility is a
-- material change to what participants agreed to, so it invalidates all
-- registered confirmations — everyone must re-confirm (same rule as a score edit).
create or replace function public.set_match_privacy(
  p_match_id  uuid,
  p_is_public boolean
)
returns void language plpgsql security definer as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if v_match.recorder_id != auth.uid() then raise exception 'Not your match'; end if;
  if v_match.status not in ('draft', 'pending') then
    raise exception 'Cannot change visibility of a % match', v_match.status;
  end if;

  -- No-op if unchanged, so we don't needlessly reset confirmations.
  if v_match.is_public is not distinct from p_is_public then return; end if;

  update public.matches set is_public = p_is_public where id = p_match_id;

  -- Visibility changed → everyone must re-confirm.
  if v_match.status = 'pending' then
    update public.match_participants
       set confirmed = false, confirmed_at = null
     where match_id = p_match_id and not is_recorder and not is_guest;
  end if;
end;
$$;

-- ── RPC: request_match_confirmation ─────────────────────────────────────────
-- draft → pending. Resets registered non-recorder confirmations. Requires at
-- least one game recorded and at least one registered non-recorder participant
-- (otherwise the match could never be published).
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
  return v_match;
end;
$$;

-- ── RPC: confirm_match ──────────────────────────────────────────────────────
-- A registered non-recorder participant confirms. When all such participants
-- have confirmed, the match is published.
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
    -- Phase 2: perform public.apply_match_rating(p_match_id);
  else
    select * into v_match from public.matches where id = p_match_id;
  end if;

  return v_match;
end;
$$;

-- ── RPC: cancel_match ───────────────────────────────────────────────────────
create or replace function public.cancel_match(p_match_id uuid)
returns void language plpgsql security definer as $$
declare
  v_match public.matches;
begin
  select * into v_match from public.matches where id = p_match_id;
  if not found then raise exception 'Match not found'; end if;
  if v_match.recorder_id != auth.uid() then raise exception 'Not your match'; end if;
  if v_match.status = 'published' then raise exception 'Cannot cancel a published match'; end if;
  update public.matches set status = 'canceled' where id = p_match_id;
end;
$$;

-- ── Realtime ────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_participants;
alter publication supabase_realtime add table public.match_games;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.matches             enable row level security;
alter table public.match_participants  enable row level security;
alter table public.match_games         enable row level security;

-- A match is visible to: its recorder; any of its participants; or anyone (auth)
-- if it is published AND public. Draft matches are visible only to the recorder.
--
-- This check is a SECURITY DEFINER function so it can be shared by the matches,
-- match_participants, and match_games policies WITHOUT mutual RLS recursion
-- (matches → match_participants → matches → …). Running as definer means the
-- inner reads bypass RLS, breaking the cycle.
create or replace function public.can_view_match(p_match_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1 from public.matches m
    where m.id = p_match_id
      and (
        m.recorder_id = auth.uid()
        or (m.status = 'published' and m.is_public and auth.uid() is not null)
        or exists (
          select 1 from public.match_participants mp
          where mp.match_id = m.id and mp.user_id = auth.uid()
        )
      )
  );
$$;
grant execute on function public.can_view_match(uuid) to anon, authenticated;

create policy "matches_select" on public.matches
  for select using (public.can_view_match(id));
-- All writes go through SECURITY DEFINER RPCs; no direct table writes.

-- Participants/games inherit the parent match's visibility.
create policy "match_participants_select" on public.match_participants
  for select using (public.can_view_match(match_id));

create policy "match_games_select" on public.match_games
  for select using (public.can_view_match(match_id));

grant execute on function public.create_match               to authenticated;
grant execute on function public.set_match_games            to authenticated;
grant execute on function public.replace_match_participant  to authenticated;
grant execute on function public.set_match_privacy          to authenticated;
grant execute on function public.request_match_confirmation to authenticated;
grant execute on function public.confirm_match              to authenticated;
grant execute on function public.cancel_match               to authenticated;
