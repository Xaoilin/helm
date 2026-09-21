# Banking review and loans

Finance displays a private, dated banking review alongside existing accounts,
budgets, savings goals, Stocks and Options. The overview separates regular salary,
essential commitments and work costs from the amount remaining before optional
spending and irregular costs. Planned changes remain explicitly dated assumptions.
Spending shows complete-month receipts, payments, net cash change and payment
categories, with high-value spending groups to review. Loans keeps lender balances,
settlement figures, repayments, ownership shares and source dates distinct.

## Source and calculation boundaries

The review is an account-owned snapshot, not a live bank feed or an executable
financial instruction. An authorized external agent reads the user's connected
read-only banking provider, reconciles the evidence and saves a bounded review
through the Finance MCP. No bank credentials or personal seed data ship in the
repository or public bundle. Refreshing this snapshot requires another authorized
read and semantic save; the page does not promise automatic synchronization.

All amounts are integer pence. Personal-account transfers are removed from both
receipts and payments. Household contributions are counted once; downstream
shared-account bills are not added again. Receipts can include refunds, loan
proceeds and asset sales and must not all be treated as recurring salary. Payment
categories describe cash payments, including debt repayments, rather than a
complete measure of consumption. Unknown purposes remain unclassified. Partial
months and missing historical card purchases are disclosed in coverage notes.

The displayed budget is a planning calculation, not guaranteed disposable cash.
Its essential rows, work-cost allowance, source period and scenario adjustments
remain visible. A positive scenario adjustment adds an expense and reduces the
remainder. Shopping or software totals are review candidates, not automatically
unnecessary costs or verified recurring subscriptions.

A loan's original advance, current account balance and settlement amount are
different quantities. Unknown balances stay unknown, never zero. Historical
figures retain their dates. Repayment and consolidation intentions do not imply
that a lender has approved a change or that a financial transaction occurred.
Review balances do not modify existing account net worth or Equity holdings.

## Private persistence and external access

The authenticated `financeReviews` collection holds one current review. The
`sabah-one-finance-mcp/mcp` endpoint exposes `finance_get_review` and
`finance_save_review`. Save requires a stable idempotency request ID and the
previous record's exact revision, or a null revision for the first save.
Reusing a request ID is permitted only for the same payload. Conflicting edits
require a read before a new save. Owner identity comes from the authenticated
session, not a caller-supplied account identifier.

Finance requires its own OAuth client approval; Inventory, Employment and Equity
approval do not grant access. Revocation is enforced on subsequent requests.
The endpoint cannot move money, transact in investments, change lender agreements
or expose arbitrary application collections. External agents cannot substitute
direct database access, copied sessions or UI automation for this interface.
An unavailable Finance MCP is an explicit import blocker, not a saved review.

## Acceptance

Synthetic tests cover report arithmetic, missing loan values, account changes,
authorization, idempotency, revision conflicts and responsive rendering. At
v0.2.161, protected CI and Sol-owned deployment passed, separate Finance OAuth
consent completed, and the personal review was semantically saved, read back
exactly and preserved through a browser reload. No personal values are stored in
the repository or its acceptance fixtures.
