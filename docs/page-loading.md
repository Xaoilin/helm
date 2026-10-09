# Account page loading

Every domain provider loads its own data from its Spring service, most through
`useServiceLoad` (`src/store/contexts/useServiceLoad.ts`): once when the
signed-in session's providers mount, again after a change another tab or device
saved (the live-update stream), and after a failed load (a few timed retries,
then whenever the page is shown again). Confirmed data stays in memory for the
session, so navigating between pages reuses it. No account data is kept in
browser storage.

`PageReadinessGate` shows `Loading page data...` until the providers the page
needs have answered. Shared prayer overlays and daily rollover need settings,
progress, momentum, tasks and prayer. Calendar and Integrations also wait for
Calendar, Clock for Clock, Knowledge for Knowledge, Projects, Tasks and Secrets
for Projects, Inventory for Inventory and Projects, Trips for Trips and Calendar
(its event importer), and Health and Finance for their own domain. Dashboard
does not wait for Calendar, Knowledge or Clock; their providers can finish in the
background. Employment keeps its own loading and retry UI. Navigation stays
available while a page loads.

A failed load keeps the last confirmed data on screen with the service's error
and a Retry control; a failed write says the change was not saved and reloads
what the service holds. While the browser reports being offline, pages are
read-only under an Offline banner; they become editable again when it is back
online.

Account changes remount every provider (keyed by the signed-in session), so the
previous account's data is cleared before the next account's pages load theirs.
The generic Supabase record store that used to hydrate pages in scoped snapshots
was retired in v0.2.206.

Secrets list their summaries through the Vault RPCs when the page opens, after
each of the page's own writes, and whenever the page is focused or shown again.
Revealed values are cleared when the page is hidden or loses focus.

Release checks run before the sign-in gate, so a sign-in problem cannot prevent
detecting a new build. Open editors, visible drafts and hidden tabs keep the
existing automatic-reload protections.
