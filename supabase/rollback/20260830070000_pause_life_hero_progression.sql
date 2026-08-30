begin;

-- Non-destructive rollback: stop all new awards and recomputation while
-- preserving owner-readable profiles, evidence, awards, and legacy snapshots.
revoke execute on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) from authenticated;
revoke execute on function public.recompute_life_hero_profile(date)
from authenticated;
revoke execute on function public.sync_life_hero_evidence(date)
from authenticated;

commit;
