-- ============================================================
-- SCHEMA — run this on a fresh Supabase project
-- ============================================================

-- ============================================================
-- 1. TABLES
-- ============================================================

create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  nickname       text not null default '',
  avatar_url     text,
  venmo_username text,
  is_admin       boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  location            text not null,
  location_address    text,
  notes               text,
  starts_at           timestamptz not null,
  withdraw_deadline   timestamptz not null,
  max_participants    int not null default 8,
  court_count         int not null default 2,
  fee_per_person      numeric(10,2) default null,
  late_withdraw_ratio numeric(3,2) default null,
  status              text not null default 'open'
                        check (status in ('open', 'locked', 'canceled', 'closed')),
  initiator_id        uuid not null references public.profiles(id),
  created_at          timestamptz not null default now()
);

create table public.participants (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  display_name   text not null,
  queue_position int not null,
  status         text not null default 'joined'
                   check (status in ('joined', 'waitlist', 'withdrawn', 'late_withdraw')),
  stayed_late    boolean not null default false,
  joined_at      timestamptz not null default now(),
  withdrew_at    timestamptz
);

create table public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.sessions(id) on delete cascade,
  type        text not null check (type in ('venmo', 'zelle', 'other')),
  label       text not null,
  account_ref text not null,
  amount      numeric(10,2) default null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.payment_records (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  status         text not null default 'unpaid'
                   check (status in ('unpaid', 'paid', 'waived')),
  note           text,
  reminder_sent  boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (participant_id)
);

create table public.participant_renames (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  old_name       text not null,
  new_name       text not null,
  created_at     timestamptz not null default now()
);

create table public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz default now(),
  primary key (follower_id, following_id)
);

create table public.session_admins (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (session_id, user_id)
);

-- ============================================================
-- 2. FUNCTIONS AND TRIGGERS
-- ============================================================

-- Auto-create profile on sign-up (with DiceBear avatar fallback)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1), 'Player'),
    coalesce(
      new.raw_user_meta_data->>'avatar_url',
      'https://api.dicebear.com/9.x/thumbs/svg?seed=' || new.id::text
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Concurrency-safe join (allows +1/+2 by name, blocks same name twice)
create or replace function public.join_session(
  p_session_id   uuid,
  p_user_id      uuid,
  p_display_name text
)
returns public.participants
language plpgsql security definer
as $$
declare
  v_session      public.sessions;
  v_joined_count int;
  v_queue_pos    int;
  v_status       text;
  v_result       public.participants;
begin
  perform pg_advisory_xact_lock(abs(hashtext(p_session_id::text)));

  select * into v_session from public.sessions where id = p_session_id;
  if not found then raise exception 'Session not found'; end if;
  if v_session.status != 'open' then raise exception 'Session is not open for joining'; end if;

  if exists (
    select 1 from public.participants
    where session_id   = p_session_id
      and user_id      = p_user_id
      and display_name = p_display_name
      and status in ('joined', 'waitlist')
  ) then
    raise exception 'You already have an active entry with this name';
  end if;

  select coalesce(max(queue_position), 0) + 1
    into v_queue_pos
    from public.participants where session_id = p_session_id;

  select count(*) into v_joined_count
    from public.participants
   where session_id = p_session_id and status = 'joined';

  v_status := case
    when v_joined_count < v_session.max_participants then 'joined'
    else 'waitlist'
  end;

  insert into public.participants (session_id, user_id, display_name, queue_position, status)
  values (p_session_id, p_user_id, p_display_name, v_queue_pos, v_status)
  returning * into v_result;

  return v_result;
end;
$$;

-- Update session capacity and reshuffle participants accordingly
create or replace function public.update_session_capacity(
  p_session_id      uuid,
  p_max_participants int
)
returns void language plpgsql security definer as $$
declare
  v_current_joined int;
  v_diff           int;
begin
  if not exists (
    select 1 from public.session_admins
    where session_id = p_session_id and user_id = auth.uid()
  ) then raise exception 'Not an admin'; end if;

  select count(*) into v_current_joined
    from public.participants
   where session_id = p_session_id and status = 'joined';

  v_diff := p_max_participants - v_current_joined;

  if v_diff > 0 then
    -- Cap increased: promote first v_diff waitlisted users
    update public.participants set status = 'joined'
     where id in (
       select id from public.participants
        where session_id = p_session_id and status = 'waitlist'
        order by queue_position
        limit v_diff
     );
  elsif v_diff < 0 then
    -- Cap decreased: demote last abs(v_diff) joined users back to waitlist
    update public.participants set status = 'waitlist'
     where id in (
       select id from public.participants
        where session_id = p_session_id and status = 'joined'
        order by queue_position desc
        limit abs(v_diff)
     );
  end if;

  update public.sessions set max_participants = p_max_participants where id = p_session_id;
end;
$$;

grant execute on function public.update_session_capacity to authenticated;

-- Withdraw (handles late penalty + promotes first waitlisted participant)
create or replace function public.withdraw_participant(
  p_participant_id uuid,
  p_user_id        uuid
)
returns public.participants
language plpgsql security definer
as $$
declare
  v_participant public.participants;
  v_session     public.sessions;
  v_late        bool;
  v_new_status  text;
begin
  select * into v_participant from public.participants where id = p_participant_id;
  if not found then raise exception 'Participant not found'; end if;
  if v_participant.user_id != p_user_id then raise exception 'Not your entry'; end if;

  select * into v_session from public.sessions where id = v_participant.session_id;
  if v_session.status in ('locked', 'closed') then
    raise exception 'Cannot withdraw from a locked or closed session';
  end if;
  v_late       := now() > v_session.withdraw_deadline and v_participant.status = 'joined';
  v_new_status := case when v_late then 'late_withdraw' else 'withdrawn' end;

  update public.participants
     set status = v_new_status, withdrew_at = now()
   where id = p_participant_id
   returning * into v_participant;

  if v_new_status in ('withdrawn', 'late_withdraw') then
    update public.participants p set status = 'joined'
     where p.session_id = v_session.id
       and p.status = 'waitlist'
       and (select count(*) from public.participants
             where session_id = v_session.id and status = 'joined') < v_session.max_participants
       and p.queue_position = (select min(queue_position) from public.participants
                                where session_id = v_session.id and status = 'waitlist');
  end if;

  return v_participant;
end;
$$;

-- Auto-initialize payment records when a session is locked
create or replace function public.initialize_payment_records()
returns trigger language plpgsql security definer as $$
begin
  if new.status = 'locked' and old.status != 'locked' then
    insert into public.payment_records (session_id, participant_id, status)
    select new.id, p.id, 'unpaid'
      from public.participants p
     where p.session_id = new.id
       and p.status = 'joined'
       and not exists (
         select 1 from public.payment_records r where r.participant_id = p.id
       );
  end if;
  return new;
end;
$$;

create trigger on_session_locked
  after update on public.sessions
  for each row execute function public.initialize_payment_records();

-- Auto-add session initiator as first admin
create or replace function public.add_initiator_as_admin()
returns trigger language plpgsql security definer as $$
begin
  insert into public.session_admins (session_id, user_id)
  values (new.id, new.initiator_id)
  on conflict do nothing;
  return new;
end;
$$;

create trigger on_session_created
  after insert on public.sessions
  for each row execute function public.add_initiator_as_admin();

-- Rename own participant entry (records the rename in participant_renames for the timeline)
create or replace function public.rename_participant(
  p_participant_id uuid,
  p_new_name       text
)
returns public.participants
language plpgsql security definer
as $$
declare
  v_participant public.participants;
  v_old_name    text;
  v_new_name    text;
begin
  v_new_name := btrim(p_new_name);
  if v_new_name = '' then raise exception 'New name cannot be empty'; end if;

  select * into v_participant from public.participants where id = p_participant_id;
  if not found then raise exception 'Participant not found'; end if;
  if v_participant.user_id != auth.uid() then raise exception 'Not your entry'; end if;

  v_old_name := v_participant.display_name;
  if v_old_name = v_new_name then return v_participant; end if;

  update public.participants
     set display_name = v_new_name
   where id = p_participant_id
   returning * into v_participant;

  insert into public.participant_renames (session_id, participant_id, user_id, old_name, new_name)
  values (v_participant.session_id, v_participant.id, v_participant.user_id, v_old_name, v_new_name);

  return v_participant;
end;
$$;

grant execute on function public.rename_participant to authenticated;

-- ============================================================
-- 3. REALTIME
-- ============================================================

alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.payment_records;
alter publication supabase_realtime add table public.participant_renames;

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles            enable row level security;
alter table public.sessions            enable row level security;
alter table public.participants        enable row level security;
alter table public.payment_methods     enable row level security;
alter table public.payment_records     enable row level security;
alter table public.follows             enable row level security;
alter table public.session_admins      enable row level security;
alter table public.participant_renames enable row level security;

-- profiles
create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- sessions
create policy "sessions_select_all"  on public.sessions for select using (true);
create policy "sessions_insert_auth" on public.sessions for insert with check (auth.uid() = initiator_id);
create policy "sessions_update_admin" on public.sessions for update
  using (exists (
    select 1 from public.session_admins
    where session_id = sessions.id and user_id = auth.uid()
  ));

-- participants
create policy "participants_select_all"  on public.participants for select using (true);
create policy "participants_insert_auth" on public.participants for insert with check (auth.uid() = user_id);
create policy "participants_update_admin" on public.participants for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.session_admins
      where session_id = participants.session_id and user_id = auth.uid()
    )
  );

-- payment_methods
create policy "methods_select_all"   on public.payment_methods for select using (true);
create policy "methods_insert_admin" on public.payment_methods for insert
  with check (exists (
    select 1 from public.session_admins
    where session_id = payment_methods.session_id and user_id = auth.uid()
  ));
create policy "methods_update_admin" on public.payment_methods for update
  using (exists (
    select 1 from public.session_admins
    where session_id = payment_methods.session_id and user_id = auth.uid()
  ));
create policy "methods_delete_admin" on public.payment_methods for delete
  using (exists (
    select 1 from public.session_admins
    where session_id = payment_methods.session_id and user_id = auth.uid()
  ));

-- payment_records
create policy "payment_records_select_authenticated" on public.payment_records
  for select using (auth.role() = 'authenticated');
create policy "payment_records_insert_own" on public.payment_records
  for insert with check (exists (
    select 1 from public.participants
    where participants.id = payment_records.participant_id
      and participants.user_id = auth.uid()
  ));
create policy "payment_records_update_own" on public.payment_records
  for update using (exists (
    select 1 from public.participants
    where participants.id = payment_records.participant_id
      and participants.user_id = auth.uid()
  ));

-- follows
create policy "follows_select" on public.follows
  for select using (auth.role() = 'authenticated');
create policy "follows_insert" on public.follows
  for insert with check (auth.uid() = follower_id);
create policy "follows_delete" on public.follows
  for delete using (auth.uid() = follower_id);

-- session_admins
create policy "admins_select_authenticated" on public.session_admins
  for select using (auth.role() = 'authenticated');
create policy "admins_insert_admin" on public.session_admins
  for insert with check (exists (
    select 1 from public.session_admins existing
    where existing.session_id = session_admins.session_id
      and existing.user_id = auth.uid()
  ));
create policy "admins_delete_admin" on public.session_admins
  for delete using (
    exists (
      select 1 from public.session_admins existing
      where existing.session_id = session_admins.session_id
        and existing.user_id = auth.uid()
    )
    and user_id != (select initiator_id from public.sessions where id = session_id)
  );

-- participant_renames (read-only for everyone; writes happen via rename_participant RPC)
create policy "renames_select_all" on public.participant_renames for select using (true);

-- ============================================================
-- 5. STORAGE: avatars bucket (user-uploaded profile pictures)
-- ============================================================

insert into storage.buckets (id, name, public)
  values ('avatars', 'avatars', true)
  on conflict (id) do nothing;

-- Anyone can read avatars (they're public profile pictures).
create policy "avatars_public_read" on storage.objects for select
  using (bucket_id = 'avatars');

-- Users can upload to a folder named after their own auth uid (path: <uid>/avatar.jpg).
create policy "avatars_insert_own" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- 6. GRANTS
-- ============================================================

grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
grant execute on function public.join_session         to authenticated;
grant execute on function public.withdraw_participant to authenticated;
grant execute on function public.rename_participant   to authenticated;

-- ============================================================
-- 7. INDEXES
-- ============================================================

create index if not exists idx_sessions_starts_at   on public.sessions(starts_at);
create index if not exists idx_participants_session  on public.participants(session_id, queue_position);

-- ============================================================
-- 7. RESTAURANTS (赛后总结)
-- ============================================================

create table public.restaurants (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  cuisine              text,
  distance             text,
  address              text,
  hours                text,
  yelp_url             text,
  google_maps_url      text,
  has_wait             boolean not null default false,
  accepts_reservation  boolean not null default false,
  group_size           text,
  added_by             uuid references public.profiles(id),
  last_updated_by      uuid references public.profiles(id),
  created_at           timestamptz not null default now()
);

create table public.restaurant_dishes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  added_by      uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create table public.restaurant_recommendations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id       uuid not null references public.profiles(id),
  recommended   boolean not null,
  created_at    timestamptz not null default now(),
  unique(restaurant_id, user_id)
);

alter table public.restaurants               enable row level security;
alter table public.restaurant_dishes         enable row level security;
alter table public.restaurant_recommendations enable row level security;

-- restaurants
create policy "restaurants_select_auth"  on public.restaurants for select using (auth.uid() is not null);
create policy "restaurants_insert_auth"  on public.restaurants for insert with check (auth.uid() = added_by);
create policy "restaurants_update_auth"  on public.restaurants for update using (auth.uid() is not null);
-- Admin can delete anything; regular users can only delete if they added it and no one else has edited it
create policy "restaurants_delete_auth"  on public.restaurants for delete using (
  exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
  or (
    auth.uid() = added_by
    and (last_updated_by is null or last_updated_by = auth.uid())
  )
);

-- restaurant_dishes
create policy "dishes_select_auth"   on public.restaurant_dishes for select using (auth.uid() is not null);
create policy "dishes_insert_auth"   on public.restaurant_dishes for insert with check (auth.uid() = added_by);
create policy "dishes_delete_own"    on public.restaurant_dishes for delete using (auth.uid() = added_by);

-- restaurant_recommendations
create policy "recs_select_auth"  on public.restaurant_recommendations for select using (auth.uid() is not null);
create policy "recs_all_own"      on public.restaurant_recommendations for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.restaurant_tags (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null,
  added_by      uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  unique(restaurant_id, name)
);

alter table public.restaurant_tags enable row level security;

create policy "tags_select_auth"  on public.restaurant_tags for select using (auth.uid() is not null);
create policy "tags_insert_auth"  on public.restaurant_tags for insert with check (auth.uid() = added_by);
create policy "tags_delete_own"   on public.restaurant_tags for delete using (auth.uid() = added_by);

create index if not exists idx_restaurant_dishes_restaurant on public.restaurant_dishes(restaurant_id);
create index if not exists idx_recs_restaurant on public.restaurant_recommendations(restaurant_id);
create index if not exists idx_restaurant_tags_restaurant on public.restaurant_tags(restaurant_id);

-- Migration (run in Supabase SQL editor if tables already exist):
-- drop policy if exists "restaurants_update_own" on public.restaurants;
-- drop policy if exists "restaurants_delete_own" on public.restaurants;
-- drop policy if exists "restaurants_delete_auth" on public.restaurants;
-- create policy "restaurants_update_auth" on public.restaurants for update using (auth.uid() is not null);
-- alter table public.restaurants add column if not exists last_updated_by uuid references public.profiles(id);
-- create policy "restaurants_delete_auth" on public.restaurants for delete using (
--   exists (select 1 from public.profiles where id = auth.uid() and is_admin = true)
--   or (auth.uid() = added_by and (last_updated_by is null or last_updated_by = auth.uid()))
-- );
-- create table if not exists public.restaurant_tags ( ... see above ... );
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'vegabaixuan@gmail.com');
create index if not exists idx_sessions_starts_at     on public.sessions(starts_at);
create index if not exists idx_participants_session   on public.participants(session_id, queue_position);
create index if not exists idx_renames_session        on public.participant_renames(session_id, created_at desc);

-- ============================================================
-- 8. 对战 (VERSUS / MATCHES)
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
create or replace function public.set_match_privacy(
  p_match_id  uuid,
  p_is_public boolean
)
returns void language plpgsql security definer as $$
begin
  update public.matches set is_public = p_is_public
   where id = p_match_id and recorder_id = auth.uid();
  if not found then raise exception 'Not your match'; end if;
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
