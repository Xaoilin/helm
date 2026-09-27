-- Product-usage ("Activity") events are now stored and summarised by the Sabah One profile service
-- (POST /api/profile/v1/activity/events, GET /api/profile/v1/activity/insights), which copied this
-- table once. Retire the browser ingest RPC so public.product_usage_events becomes read-only history.
-- The table (and its owner-only read policy) is kept for now; drop it in a later migration.
begin;

drop function if exists public.ingest_product_usage_events(jsonb);

comment on table public.product_usage_events is
  'Read-only history of Sabah One product events. Ingest moved to the profile service (activity schema).';

commit;
