-- ============================================================
-- One-time backfill: recompute all 对战 ELO ratings from scratch.
--
-- Why: apply_match_rating only runs at publish time (inside confirm_match),
-- wired in by the Phase 2 migration. Matches that were already published
-- before that migration never got rated, so their participants are missing
-- from player_ratings / the leaderboard. This recomputes every published
-- match in publish order, which also normalises any legacy unbounded-scale
-- ratings written before the round()-on-persist fix.
--
-- Prereq: apply the apply_match_rating precision fix first (schema.sql /
-- migrations_versus_phase2.sql) so the recomputed values are stored at 2 dp.
--
-- Idempotent: clears both rating tables, then replays. Safe to re-run.
-- ============================================================
begin;

truncate public.rating_history;
delete from public.player_ratings;

do $$
declare m record;
begin
  for m in
    select id from public.matches
    where status = 'published'
    order by published_at nulls last, created_at
  loop
    perform public.apply_match_rating(m.id);
  end loop;
end $$;

commit;
