# Account page loading

Providers stay mounted for the signed-in account, but optional domains read only
when an owning view opens. `useDomainDemand` lists those consumers: Calendar,
Integrations and Trips need Calendar; Projects, Tasks, Secrets and Inventory
need Projects; other optional domains load for their own view. Settings,
Prayer, Tasks, Progress, daily momentum and Clock remain shared shell
dependencies for reminders, overlays, timer alarms and Dashboard readiness.
Clock must load on a cold Dashboard and follow off-page timer changes so its
existing completion alarm still runs. Integration summaries load only
in Integrations. The existing Jev prototype panel registers Inventory, Projects
and Knowledge demand only while open; closing it releases those consumers.
Its commands wait for those required data sources. No account data is kept in browser storage.

`useServiceLoad` shares concurrent reads, retains same-account confirmed memory
for up to ten minutes on a warm revisit or visibility return, and invalidates it
after a matching live change or reconnect. Closed views remember invalidation
without fetching; reopening one reads once. The existing 300 ms live-event
coalescer groups reconnect/change bursts. A change arriving during a read queues
one trailing read, so the earlier response cannot make the change disappear.
Failures remain visible and retry only while a consumer is active. Account
changes still remount every provider through `auth.sessionKey`; memory is never
shared between those instances, and cached data never substitutes for service
authorization of a write.

Calendar requests the displayed seven-day week, full 42-cell month, or a
30-day Agenda page. Agenda has previous/next controls so later dates remain
reachable. Accounts, Integrations and the Trips source picker use the existing
Calendar endpoint with a one-day window because no metadata-only endpoint
exists. The service returns every account/source and adds its existing timezone
boundary padding to event reads. Date markers use UTC arithmetic; display and
event filtering retain the account's app zone. An obsolete window response is
discarded; the latest window loads after the current read. Confirmed overlapping
events stay mounted while refreshing, preserving focus. Loading occupies a
reserved status line, and event creation waits for a successful required read.
401/403 responses clear Calendar data; transient failures retain confirmed data
and show Retry. Automatic Google sync runs only while a Calendar consumer is
active and visible; provider sync behavior is otherwise unchanged.

`PageReadinessGate` shows `Loading page data...` until the providers the page
needs have answered, except Dashboard, which renders immediately after sign-in.
Its Prayer, Learn/Move and Tasks sections show their own pending state and appear
independently, so a slow Progress or momentum read cannot hide the reading card
or an already loaded Tasks section. Progress actions and task counts are hidden
until their data is loaded. The confirmed prayer timetable appears without
waiting for outcome history; unknown outcome badges say Loading and completion
stays disabled. Prayer history waits for the service's first confirmation;
later transient failures keep the same account's confirmed
data visible. Prayer reads start when the service-owned location is final,
alongside Tasks; tracking writes and actions retain their source-readiness gate.
Prayer times can appear before Tasks and Progress finish; their completion
buttons stay disabled until the dialogs, rewards and required sources are ready.
The dashboard's desktop content scroller is keyboard focusable.

Shared prayer overlays and daily rollover need settings,
progress, momentum, tasks and prayer. Calendar and Integrations also wait for
Calendar, Clock for Clock, Knowledge for Knowledge, Projects, Tasks and Secrets
for Projects, Inventory for Inventory and Projects, Trips for Trips and Calendar
(its event importer), and Health and Finance for their own domain. Dashboard
does not activate Calendar, Knowledge, Projects, Inventory, Employment,
Health, Trips or Finance. Calendar keeps its navigation mounted and shows its
own date-window pending state; other pages retain their dependency gate.
Employment keeps its own loading and retry UI. Navigation stays
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
