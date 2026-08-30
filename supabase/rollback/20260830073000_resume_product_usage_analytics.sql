begin;
grant execute on function public.ingest_product_usage_events(jsonb) to authenticated;
commit;
