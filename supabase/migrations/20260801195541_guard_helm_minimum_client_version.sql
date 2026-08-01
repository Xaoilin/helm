begin;

-- The original mutation RPC predates the 0.2.83 complete-snapshot floor and
-- still writes 0.2.82 on every successful mutation. Keep that stale literal
-- from downgrading account compatibility while preserving newer future floors.
create or replace function helm_private.guard_helm_minimum_client_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.minimum_client_version = '0.2.82' then
    new.minimum_client_version := '0.2.83';
  end if;
  return new;
end;
$$;

revoke execute on function helm_private.guard_helm_minimum_client_version()
from public, anon, authenticated;

drop trigger if exists guard_helm_minimum_client_version
on public.helm_account_state;

create trigger guard_helm_minimum_client_version
before insert or update of minimum_client_version
on public.helm_account_state
for each row
when (new.minimum_client_version = '0.2.82')
execute function helm_private.guard_helm_minimum_client_version();

update public.helm_account_state
set minimum_client_version = '0.2.83', updated_at = now()
where minimum_client_version = '0.2.82';

commit;
