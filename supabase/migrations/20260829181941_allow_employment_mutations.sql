-- Employment is a first-party account-backed collection. Add it to the
-- existing authenticated mutation boundary without changing the boundary's
-- ownership, grants, SECURITY DEFINER configuration, or Inventory exclusion.
do $migration$
declare
  v_definition text;
  v_needle constant text := $needle$    'gamification', 'prayerTracking', 'assistantCorrections', 'assistantActivityLog'
  ];$needle$;
  v_replacement constant text := $replacement$    'gamification', 'prayerTracking', 'assistantCorrections', 'assistantActivityLog',
    'employment'
  ];$replacement$;
begin
  select pg_get_functiondef(
    'helm_private.apply_helm_mutations_direct(uuid,jsonb)'::regprocedure
  ) into v_definition;

  if strpos(
    v_definition,
    $guard$    'gamification', 'prayerTracking', 'assistantCorrections', 'assistantActivityLog',
    'employment'
  ];$guard$
  ) > 0 then
    return;
  end if;

  if strpos(v_definition, v_needle) = 0 then
    raise exception
      'apply_helm_mutations_direct allowed collection list has drifted; refusing an unsafe rewrite';
  end if;

  execute replace(v_definition, v_needle, v_replacement);
end;
$migration$;
