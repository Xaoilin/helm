create or replace function public.inventory_resolve_project(p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_projects jsonb;
  v_normalized_query text;
begin
  v_user_id := helm_private.require_inventory_actor();
  if p_query is null or p_query <> btrim(p_query) or length(p_query) not between 1 and 160 then
    raise exception 'Project query is invalid.' using errcode = '22023';
  end if;

  v_normalized_query := regexp_replace(lower(p_query), '[^a-z0-9]+', '', 'g');
  if v_normalized_query = '' then
    raise exception 'Project query is invalid.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', project.record_id,
    'catalogKey', project.payload ->> 'catalogKey',
    'name', project.payload ->> 'name'
  ) order by lower(project.payload ->> 'name')), '[]'::jsonb)
  into v_projects
  from (
    select record.record_id, record.payload
    from public.helm_records as record
    where record.user_id = v_user_id and record.collection = 'projects'
      and record.deleted_at is null
      and (
        lower(record.payload ->> 'name') like '%' || lower(p_query) || '%'
        or lower(record.payload ->> 'catalogKey') = lower(p_query)
        or exists (
          select 1
          from jsonb_array_elements_text(
            case
              when jsonb_typeof(record.payload -> 'tags') = 'array' then record.payload -> 'tags'
              else '[]'::jsonb
            end
          ) as project_tag(value)
          where regexp_replace(lower(project_tag.value), '[^a-z0-9]+', '', 'g') = v_normalized_query
        )
      )
    order by lower(record.payload ->> 'name')
    limit 10
  ) as project;
  return v_projects;
end;
$$;

revoke all on function public.inventory_resolve_project(text) from public, anon;
grant execute on function public.inventory_resolve_project(text) to authenticated;
