begin;
revoke execute on function public.ingest_product_usage_events(jsonb) from authenticated;
commit;
