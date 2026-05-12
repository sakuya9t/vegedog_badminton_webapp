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

create index if not exists idx_sessions_starts_at     on public.sessions(starts_at);
create index if not exists idx_participants_session   on public.participants(session_id, queue_position);
create index if not exists idx_renames_session        on public.participant_renames(session_id, created_at desc);
