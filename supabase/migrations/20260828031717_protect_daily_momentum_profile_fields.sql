-- Daily momentum is stored additively on gamification/profile so the existing
-- account-authoritative record, ownership predicate, grants, and RLS remain the
-- only persistence surface. Protect the two reserved fields from legacy clients
-- that build a patch by unsetting every key they do not understand.
do $migration$
declare
  v_definition text;
  v_needle constant text := $needle$        for v_unset_key in
          select value from jsonb_array_elements_text(v_operation -> 'unset')
        loop
          v_payload := v_payload - v_unset_key;
        end loop;$needle$;
  v_replacement constant text := $replacement$        for v_unset_key in
          select value from jsonb_array_elements_text(v_operation -> 'unset')
        loop
          if v_collection = 'gamification'
            and v_record_id = 'profile'
            and v_unset_key = any(array['dailyMomentumLearn', 'dailyMomentumMove'])
          then
            continue;
          end if;
          v_payload := v_payload - v_unset_key;
        end loop;$replacement$;
begin
  select pg_get_functiondef(
    'helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(
    v_definition,
    $guard$v_unset_key = any(array['dailyMomentumLearn', 'dailyMomentumMove'])$guard$
  ) > 0 then
    return;
  end if;

  if strpos(v_definition, v_needle) = 0 then
    raise exception
      'apply_helm_mutations_direct unset loop has drifted; refusing an unsafe rewrite';
  end if;

  execute replace(v_definition, v_needle, v_replacement);
end;
$migration$;

comment on function helm_private.apply_helm_mutations_direct(uuid, jsonb) is
  'Applies authenticated HELM record mutations while preserving reserved additive profile fields from legacy unset patches.';
