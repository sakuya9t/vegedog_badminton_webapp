-- ============================================================
-- 对战积分 (VERSUS RATINGS — Phase 2) migration
-- Run on the EXISTING live Supabase project (dev first, then prod).
-- For a fresh project, schema.sql §8b already contains all of this.
--
-- Run-once: tables / policies / realtime are plain CREATE/ADD and will error on
-- re-run. Functions are CREATE OR REPLACE (safe to re-run).
-- ============================================================

create table public.player_ratings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  rating       numeric not null default 1000,
  games_played int not null default 0,
  peak_rating  numeric not null default 1000,
  updated_at   timestamptz not null default now()
);

create table public.rating_history (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  rating_before numeric not null,
  rating_after  numeric not null,
  delta         numeric not null,
  created_at    timestamptz not null default now(),
  unique (match_id, user_id)
);

create index if not exists idx_player_ratings_rank  on public.player_ratings(rating desc);
create index if not exists idx_rating_history_user  on public.rating_history(user_id, created_at desc);
create index if not exists idx_rating_history_match on public.rating_history(match_id);

-- ── Internal: apply_match_rating ────────────────────────────────────────────
create or replace function public.apply_match_rating(p_match_id uuid)
returns void language plpgsql security definer as $$
declare
  c_R0       constant numeric := 1000;
  c_Kmax     constant numeric := 64;
  c_Kmin     constant numeric := 16;
  c_Rfloor   constant numeric := 1000;
  c_Rceil    constant numeric := 1800;
  c_provis   constant int     := 5;
  c_gap0     constant numeric := 200;
  c_gapscale constant numeric := 600;
  c_dampmin  constant numeric := 0.25;
  c_marref   constant numeric := 21;

  v_match  public.matches;
  v_size1  int;  v_size2 int;
  v_sum1   numeric; v_cnt1 int;
  v_sum2   numeric; v_cnt2 int;
  v_r1     numeric; v_r2 numeric;
  v_winner smallint;
  v_m      numeric;
  g        record;
  p        record;
  v_Ropp   numeric; v_S numeric; v_E numeric;
  v_damp   numeric; v_K numeric; v_delta numeric;
begin
  perform pg_advisory_xact_lock(abs(hashtext('apply_match_rating:' || p_match_id::text)));

  select * into v_match from public.matches where id = p_match_id;
  if not found or v_match.status <> 'published' then return; end if;
  if exists (select 1 from public.rating_history where match_id = p_match_id) then return; end if;

  create temporary table if not exists tmp_rate (
    user_id uuid primary key,
    team    smallint not null,
    rating0 numeric not null,
    rating  numeric not null,
    games   int not null
  ) on commit drop;
  truncate tmp_rate;

  insert into tmp_rate (user_id, team, rating0, rating, games)
  select mp.user_id, mp.team,
         coalesce(pr.rating, c_R0), coalesce(pr.rating, c_R0),
         coalesce(pr.games_played, 0)
  from public.match_participants mp
  left join public.player_ratings pr on pr.user_id = mp.user_id
  where mp.match_id = p_match_id and mp.user_id is not null and not mp.is_guest;

  if not exists (select 1 from tmp_rate) then return; end if;

  select count(*) filter (where team = 1), count(*) filter (where team = 2)
    into v_size1, v_size2
  from public.match_participants where match_id = p_match_id;

  for g in
    select game_no, team1_score, team2_score
    from public.match_games where match_id = p_match_id order by game_no
  loop
    if g.team1_score = g.team2_score then continue; end if;
    v_winner := case when g.team1_score > g.team2_score then 1 else 2 end;
    v_m := 1 + ln(1 + abs(g.team1_score - g.team2_score)) / ln(1 + c_marref);

    select coalesce(sum(rating) filter (where team = 1), 0), count(*) filter (where team = 1),
           coalesce(sum(rating) filter (where team = 2), 0), count(*) filter (where team = 2)
      into v_sum1, v_cnt1, v_sum2, v_cnt2
    from tmp_rate;
    v_r1 := (v_sum1 + (v_size1 - v_cnt1) * c_R0) / v_size1;
    v_r2 := (v_sum2 + (v_size2 - v_cnt2) * c_R0) / v_size2;

    for p in select * from tmp_rate loop
      v_Ropp := case when p.team = 1 then v_r2 else v_r1 end;
      v_S    := case when p.team = v_winner then 1 else 0 end;
      v_E    := 1 / (1 + power(10, (v_Ropp - p.rating) / 400));
      v_damp := greatest(c_dampmin, least(1, 1 - greatest(0, abs(p.rating - v_Ropp) - c_gap0) / c_gapscale));
      v_K    := case when p.games < c_provis then c_Kmax
                     else greatest(c_Kmin, least(c_Kmax,
                          c_Kmax - (c_Kmax - c_Kmin) * (p.rating - c_Rfloor) / (c_Rceil - c_Rfloor))) end;
      v_delta := v_K * v_m * v_damp * (v_S - v_E);
      update tmp_rate set rating = rating + v_delta, games = games + 1 where user_id = p.user_id;
    end loop;
  end loop;

  insert into public.player_ratings (user_id, rating, games_played, peak_rating, updated_at)
  select user_id, rating, games, greatest(rating0, rating), now() from tmp_rate
  on conflict (user_id) do update
    set rating       = excluded.rating,
        games_played = excluded.games_played,
        peak_rating  = greatest(public.player_ratings.peak_rating, excluded.rating),
        updated_at   = now();

  insert into public.rating_history (match_id, user_id, rating_before, rating_after, delta)
  select p_match_id, user_id, rating0, rating, rating - rating0 from tmp_rate;
end;
$$;

-- Wire ratings into the publish branch of confirm_match (CREATE OR REPLACE).
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
  else
    select * into v_match from public.matches where id = p_match_id;
  end if;

  return v_match;
end;
$$;

-- Realtime + RLS.
alter publication supabase_realtime add table public.player_ratings;

alter table public.player_ratings enable row level security;
alter table public.rating_history enable row level security;

create policy "player_ratings_select" on public.player_ratings
  for select using (auth.uid() is not null);
create policy "rating_history_select" on public.rating_history
  for select using (user_id = auth.uid() or public.can_view_match(match_id));
