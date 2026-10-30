# Banking review and loans

Finance displays a private, dated banking review alongside existing accounts,
budgets, savings goals, Stocks and Options. The overview separates regular salary,
essential commitments and work costs from the amount remaining before optional
spending and irregular costs. Planned changes remain explicitly dated assumptions.
Spending shows complete-month receipts, payments, net cash change and payment
categories, with high-value spending groups to review. Loans keeps lender balances,
settlement figures, repayments, ownership shares and source dates distinct.

Spending opens with this month's review and a last-month shortcut. Each imported
month has a payment breakdown with category search, money in, money out and net
cash flow. Missing months remain unavailable rather than zero; partial totals are
never compared with a complete month. Full-month differences compare only adjacent
complete months. Refund categories remain visible separately from the positive
spending totals. Savings suggestions retain their own source periods and conditions;
a suggested cap shows its illustrative saving without labelling all spending
unnecessary. Full budget assumptions, historical cash flow and sources remain
available below the summary.

The presentation uses the Finance MCP review and adds no bank
connection, payment capability or automatic refresh. Agents refresh the private
review through `finance_get_review` and `finance_save_review`; receipt evidence
must be reconciled with bank payments before being added to monthly totals.

## Expense groups

Finance → Spending groups each imported month's categories into Non-discretionary,
Discretionary but necessary, and 100% discretionary, with signed totals per group.
Mortgage, loan repayments and bills start in the first group; food, takeaways and
fuel start in the middle group; subscriptions, entertainment and clothes start in
the last group. These are labelled suggestions, not verified judgments about each
purchase. Broad unknown labels start in the middle group marked “Needs your review”.
Mixed source categories move as a whole; this snapshot has no individual receipts
to split. Refunds retain their negative amounts, and search filters visible cards
without changing the month's group totals. No budget or loan amount changes.

Drag a category into a column or use its labelled group selector (keyboard and
touch supported). The browser sends the existing revision-checked review save and
changes the displayed placement only after the service confirms the group.
While saving, further moves are disabled. Refused or stale writes retain the
confirmed placement and show a retryable error.

The optional `expenseGroups` array stores `{ label, group }` choices privately in
the finance service. Group values are `non-discretionary`, `necessary`, and
`discretionary`. Labels match after trimming and lowercasing across all months.
The existing `finance_get_review` and `finance_save_review` semantic tools expose
these choices; agents preserve them when refreshing the dated bank analysis.
Omitting the array or sending null through the service preserves existing choices;
an explicit empty array clears them. Old snapshots need no migration. The shared
`review-expense-groups` response fixture is tested by both apps. This feature
requires the matching finance-service release before the browser/MCP release.

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

Cost-reduction scenarios (negative monthly adjustments) appear in a third target
calculation card. It shows salary, current costs, the net reduction, target costs
and the amount left before discretionary spending. Each scenario is relative to
the current budget, not added to other scenarios. Its explanation must include
any planned increases already netted into the reduction, retained commitments
and conditions such as full loan repayment. A refinance must allow for its
replacement payments; it does not remove the debt's cost. Optional spending is
already outside this calculation and must not be credited a second time.
Targets use the existing private Finance MCP scenario fields and do not change
current payments, balances or the underlying budget.

A loan's original advance, current account balance and settlement amount are
different quantities. Unknown balances stay unknown, never zero. Historical
figures retain their dates. Repayment and consolidation intentions do not imply
that a lender has approved a change or that a financial transaction occurred.
Review balances do not modify existing account net worth or Equity holdings.

## Loan overpayment calculator

Finance → Loans compares active Selina and NatWest records separately or together.
It shows opening balances, regular and extra monthly payments, estimated payoff
dates, total interest and repayments, balance curves and a monthly amortisation
table. Scenarios support an opening lump sum, delayed monthly extras, an explicit
matching contribution from the other borrower, and either keeping regular payments
to repay sooner or recalculating regular payments over the modelled remaining term.
The latter uses the normal-payment estimate's end date, not a verified contractual
term, and recalculates after each extra payment; actual lender rules may differ.

All scenario inputs are editable and stay in component memory. Selecting a single
loan preserves the other scenario while this calculator remains mounted; leaving
Loans, reloading, an account change or a refreshed review discards scenarios. No
account records, payment instructions, Direct Debits or lender agreements change.
The existing Finance MCP review tools remain the account-data interface; this
display calculation adds no stored data, service operation or approval scope.

Opening capital comes from a statement/estimated balance. For older records only,
one explicitly named `current-balance line £…` in a saved note can seed an editable
scenario, with its note provenance and latest linked source date shown. Settlement
totals and original advances are never substituted. One unambiguous explicitly
labelled fixed rate in `rateNote` may seed the borrowing rate; APR/APRC and historical
illustrations are excluded. Missing or ambiguous values require input. This is a
bounded compatibility projection of existing private data, not a writeback or an
independent verification of the source note. No personal figures ship in source.

Money is calculated in integer pence. The monthly model charges rounded interest
at the entered nominal annual rate divided by 12, then applies the month's payment;
an opening lump sum reduces capital before month one's interest. The rate stays
constant throughout, including beyond any initial fixed period. Source balances
are not automatically advanced to the selected first payment month. Daily interest,
future rate changes, fees, allowance usage and early repayment charges are excluded;
the UI discloses these limits and retains saved lender terms below each scenario.
Final payments and lump sums are capped at the amount owed. A paid-off loan's budget
is not automatically rolled into the other loan. Non-amortising loans and estimates
beyond 1,200 months have no invented payoff or complete interest-saving total.

Joint/share views only allocate displayed amounts for budgeting and retain the
whole-loan amortisation and payoff dates. A recorded payment share seeds the
allocation; otherwise 50% is explicitly assumed and editable. Matching extras
requires its own explicit checkbox; selecting a share never doubles a contribution.
The combined payoff is the later of the selected loans' payoff months.

## Private persistence and external access

The Spring finance service (`/api/finance/v1/review`) holds one current review
per account; the old `financeReviews` collection is decode-only and was imported
once. The `sabah-one-finance-mcp/mcp` endpoint forwards the agent's OAuth token
to that service and exposes `finance_get_review` and
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
