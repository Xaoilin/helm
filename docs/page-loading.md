# Account page loading

The browser loads confirmed account data for the active page and keeps it in
memory for that account. Navigating does not discard confirmed collections.
Unrequested data stays unloaded; it must never be interpreted as an empty
collection or passed to collection autosave. Account changes clear this state.

`src/store/pageCollections.ts` owns the collection mapping. The shell stays
available while the active page's providers finish hydrating. Existing domain
providers hydrate their complete group together because their normalization,
migration, and autosave logic assumes all related collections are present.

Every page needs settings/integrations, tasks/gamification/prayer tracking,
knowledge topics/entries/lifestyle items, calendar accounts/sources/events, and
clock state. These preserve prayer reminders and reward reconciliation, Google
background sync, and off-page timer alarms. Knowledge statistics are inputs to
prayer rewards. Calendar accounts must be loaded before integration status is
reconciled.

| Page | Additional collections |
| --- | --- |
| Projects, Tasks, Secrets | projects, projectPages, legacy workspaces |
| Inventory | project group, inventoryItems, inventoryNeeds |
| Trips | trips, tripLegs, tripItineraryItems, tripBookings, tripBudgetEntries |
| Employment | employment (surface retains its confirmed seed/loading path) |
| Health | healthFastFoodEntries |
| Finance | financeAccounts, transactions, financeBudgets, savingsGoals, financeReviews, equityPositions |
| Activity | assistantActivityLog and the four manual Finance collections for undo |
| Chat | project, inventory, manual Finance groups; conversations, assistantCorrections, assistantActivityLog |
| Dashboard, Calendar, Clock, Knowledge, Profile, Integrations, Settings, Debug | shared collections only |

Lina's button, keyboard shortcut, and configured wake-word listener remain
available after shared data loads. Opening or waking Lina activates the Chat
collections; hands-free conversation creation and command execution wait for both
the confirmed load and the providers' updated render. Closing Lina releases its
collection demand and invalidates a pending activation. Its demand stays active
across page navigation while open. Voice and Chat keep their existing shared
assistant runtime.
Page-specific semantic requests, including secret metadata and Life Hero's
optional dashboard snapshot, retain their existing access boundaries.

Each confirmed dataset has a ten-minute freshness window. A revisit within that
window reuses memory; an expired page requests a new scoped snapshot. If that
read discovers a newer account version, already-loaded collections are reconciled
before the global checkpoint advances, so a missed or delayed Broadcast cannot
hide their changes. KAN-319 reconciles metadata for every changed collection from
the last fully invalidated checkpoint. Only changed collections needed by the current page or
open Lina panel are fetched; previously visited inactive collections are marked
stale and refreshed on their next activation. A contiguous local mutation receipt
updates its confirmed cache directly without downloading it again. Delayed,
duplicate and missed notifications cannot acknowledge omitted changed scopes.

`get_helm_changed_collections` returns an atomic account version, changed
collection names (including deletion tombstones), and a secret-change boolean.
It returns no record bodies or secret values. A missed secret notification clears
revealed values and refreshes summaries when Secrets is mounted. This first-party
metadata RPC denies anonymous and external OAuth-client sessions, matching the
existing browser read boundary. The ten-minute check and reconnect use the same
selective catch-up. HTTPS readiness and finite recovery budgets are unchanged.

Assistant actions load 50 live records at a time, newest first. “Load more
activity” requests the next page; the loaded count describes the visible window.
Partial-list writes compare only provider-delivered records and do not reorder
the unseen tail. Multi-statement page reads are staged and version-checked before
cache replacement, so a concurrent confirmed write is retained. A changed account
version rejects that read and uses the existing bounded recovery path.

Page activation never resets recovery attempts. An explicit Retry connection
uses the existing recovery action; unrelated navigation stays available while a
failed page remains unloaded. No account contents are persisted in browser
storage, and no backend cache or new external-agent capability is introduced.
