begin;

-- Recovery after the non-destructive pause. The schema and immutable ledger
-- are retained, so resuming does not replay or duplicate evidence.
grant execute on function public.accept_life_hero_evidence(
  text, text, text, text, timestamptz, date, jsonb
) to authenticated;
grant execute on function public.recompute_life_hero_profile(date)
to authenticated;
grant execute on function public.sync_life_hero_evidence(date)
to authenticated;

commit;
