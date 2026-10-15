# Hosted synthetic fixture teardown

Employment, Finance and Equity acceptance own disposable Auth identities and OAuth clients.
They use domain MCP tools for business operations. Their shared cleanup uses only Auth Admin
and the existing first-party Prayer preferences API; no account SQL or new provider endpoint.

Cleanup reads the fixture's Prayer preferences, saves `enabled: false` and
`reminderEnabled: false` with an Idempotency-Key, and checks the service response. It then
revokes the fixture's sessions, removes its OAuth client, hard-deletes its Auth identity,
and independently requires Auth Admin readback to return 404. Finally it reads the same
Prayer profile and requires both flags to remain false. The short-lived first-party JWT
belongs only to this invented fixture and is kept in process memory for that final read.
Deleting Auth does not itself invalidate a signed JWT; the deployed service currently
permits this read. A 401, unavailable endpoint, malformed response or active profile is
missing cleanup proof and fails acceptance. A stricter future service boundary requires
a supported replacement proof before this acceptance route can pass.

The existing KAN-324 provider selects only enabled profiles with a physically present Auth
identity and rechecks that identity under a row lock before claiming reminder receipts.
The disabled post-delete profile therefore cannot drive worker evaluation. This proves
stopped active Prayer work, not physical deletion of service history or all account data.
Historical service rows and reminder receipts may remain. No human account is touched.

Every cleanup operation is attempted independently even when an earlier operation fails.
Missing fixture credentials or proof never become a pass. Receipts distinguish Auth deletion,
Auth absence, OAuth client deletion and stopped service work, retaining only static scenario
names, numeric HTTP statuses, booleans and the failed synthetic fixture ID when known.
No raw response, key, token or email is printed or saved.

Protected Supabase deployment runs all three existing hosted domain verifiers after stamping
and deploying the exact candidate. A failed verifier fails deployment acceptance and its
receipt is retained for seven days. `VITE_PRAYER_API_BASE_URL` uses the existing
`PRAYER_BACKEND_URL` repository variable. The consumer/provider HTTP fixtures are unchanged;
KAN-324 must already be deployed. Controller/Sol owns promotion and final release acceptance.

Focused regression: `npx vitest run src/test/hosted-fixture-cleanup.test.ts` includes a real
HTTP/Auth SDK boundary and negative cases for missing service/Auth proof. One disposable
hosted lifecycle verified the existing preferences route on 15 October 2026; this is not
acceptance of an unmerged HELM candidate or a claim of a new live deployment.
