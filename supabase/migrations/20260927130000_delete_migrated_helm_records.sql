-- Every Sabah One domain now lives in its Spring service, and each service imported its helm_records
-- collections once (counts verified against production before this migration shipped: Phase 1-4 domains
-- on 2026-09-26/27; finance, equity and the last prayerTracking receipts on 2026-09-27). Nothing reads or
-- writes public.helm_records any more, so its rows are deleted here.
--
-- A copy is kept in helm_private (never exposed through the API: that schema has no grants for anon or
-- authenticated) in case a later check finds something the imports missed. The table itself stays empty
-- because the services' one-time import migrations still name it.
create table if not exists helm_private.helm_records_retired_20260927 as
  select * from public.helm_records with no data;

insert into helm_private.helm_records_retired_20260927
  select * from public.helm_records;

revoke all on table helm_private.helm_records_retired_20260927 from public, anon, authenticated;

delete from public.helm_records;
