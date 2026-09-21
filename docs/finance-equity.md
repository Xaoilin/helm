# Stocks and Options

Finance keeps private equity separate from bank balances and account net worth.
The Overview shows distinct owned-share and vested-option cards, their dated
plans, what is pending and the next action. Stocks and Options tabs expand the
same account-owned records without changing banking, transactions or budgets.

Each company record includes its holdings date, owned shares, current option
grants, separate share and option plans, actions, policy notes and source links.
Grant balances are snapshots: reaching a modeled vest date does not increase
holdings automatically. Original grant expiry and a confirmed post-employment
exercise deadline are distinct fields. Six-month preparation dates derive only
from confirmed post-employment deadlines; employment notes cannot establish one.

Scenario calculations use only currently vested options whose strike is below
the assumed price. Estimated GBP proceeds are positive spread after the recorded
modeled withholding and FX, before fees. They exclude owned shares, unvested
options and account cash. Prices and assumptions carry their own dates and notes;
no executable bid, tax assessment, open tender or future liquidity is implied.

## Private persistence and agent boundary

The existing authenticated `helm_records` store owns the `equityPositions`
collection. No personal holdings, employer policy, private source links or seed
records ship in the repository or public bundle. Empty accounts start empty.
The editor and remote MCP share narrow semantic operations, optimistic record
revisions and idempotent request IDs. Saving completes after a confirmed database
receipt and refreshed account state. Account changes discard prior views.

`sabah-one-equity-mcp/mcp` exposes `equity_list_positions`, `equity_get_position`,
`equity_add_position`, `equity_update_position` and explicitly confirmed
`equity_remove_position`. Full bounded drafts are required for updates together
with the last `updatedAt`; a stale edit is rejected. Every request derives the
owner from OAuth identity and requires an independent Equity client approval.
Inventory and Employment approvals grant no Equity access. Settings can revoke
Equity access independently. OAuth clients cannot read generic shared records.

Private source reconciliation must use this published MCP after deployment and
OAuth consent, then re-read the resulting record. A prepared local import is not
a persisted account holding. If that capability is unavailable, report the exact
boundary and retain the authorized private source; do not use direct database
writes, copied browser sessions or UI automation as an account-data fallback.

This feature submits no trades, exercises, transfer requests, outbound emails,
reminder automations or market-feed subscriptions.

## Verification and delivery

Synthetic tests cover calculations, account switching, uncertain-write retries,
optimistic edits, OAuth separation and revocation, database isolation and browser
save/reload behavior. Browser evidence covers small, tablet and wide layouts.
Tests and fixtures use fictional companies and quantities. They do not establish
that personal holdings were imported or that a live offer exists.

Protected CI, Sol-owned merge/function/Pages deployment and an authenticated
personal-record readback remain separate acceptance boundaries. Live acceptance
must verify both equity and the preserved Finance banking functionality.
