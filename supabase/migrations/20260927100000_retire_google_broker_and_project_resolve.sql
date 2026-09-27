-- Phase 3 of the Spring migration.
--
-- Google Calendar: the calendar service now holds each user's Google refresh tokens, encrypted, and
-- refreshes them itself; it imported this table once on its first start. The google-calendar-oauth
-- Edge Function that kept the tokens here in plain text is deleted by the deploy, so the table goes.
--
-- Projects: they live in the knowledge service. The Inventory MCP tool resolves projects there, so the
-- RPC that read them from helm_records goes.
begin;

drop function if exists public.inventory_resolve_project(text);

drop table if exists public.google_calendar_credentials;
drop function if exists public.set_google_calendar_credentials_updated_at();

commit;
