# AI Agent Access

## Decision

Sabah One uses MCP as the external AI-agent interface. MCP fits the hosted browser product because it provides discoverable semantic tools, typed inputs, OAuth-backed account identity, and explicit per-domain approval without creating a second product runtime.

A repository CLI may validate code, fixtures, or exported test data, but it is not an account-data interface. Agents must not bypass MCP with Supabase credentials, direct table or generic record RPC access, browser automation, shared-file edits, or copied session tokens.

Lina remains the in-app conversational interface. Chat and Voice use the same grounded capability registry and mutation path. That internal path does not make a feature externally agent-accessible; external agents still require a published MCP capability.

## Agent Contract

When an AI agent accesses Sabah One, it must:

1. discover and use the published Sabah One MCP server for the target domain;
2. use semantic tools such as list, inspect, add, update, record activity, or remove rather than generic record patches;
3. derive account identity from the OAuth token and remain inside RLS and dedicated RPC boundaries;
4. request explicit user confirmation for destructive, bulk, ambiguous, or materially consequential writes;
5. claim success only from a confirmed tool receipt and re-read when the postcondition matters;
6. stop and report an unavailable capability when no published domain tool exists.

There is no direct-database or UI-automation fallback.

## Feature Contract

Every new or materially changed account-data feature must define one narrow agent surface alongside its UI:

- read tools for list/search and one-record inspection;
- create and update tools for the feature's real business operations;
- a separately confirmed remove/archive tool when the feature permits it;
- stable identifiers, bounded inputs, actionable errors, and idempotency keys for retryable writes;
- account isolation, per-client approval, least-privilege RPCs, and redacted diagnostics;
- focused contract tests, denial tests, and documentation of unsupported actions.

An internal Lina capability may share the same domain service, but it does not replace the external MCP contract. A feature without the required interface is an explicit acceptance gap, never permission to use a lower-level data path.

## Current Capability Matrix

| Domain | In-app Lina | External agent access | Current rule |
| --- | --- | --- | --- |
| Inventory | Grounded read/write capabilities | Published `sabah-one-inventory-mcp` | Use its seven narrow tools and Inventory-specific OAuth approval. |
| Employment | Navigation | `sabah-one-employment-mcp` | Use its six narrow application/history tools with a separate Employment OAuth approval. Inventory approval does not grant Employment access. |
| Life Hero | Dashboard reads, account-evidence reconciliation, and hosted GitHub evidence sync | Not yet published | KAN-264 keeps GitHub credentials and provider sync first-party/server-only; external agents cannot read snapshots or submit evidence until a dedicated Life Hero OAuth/MCP contract is published. This missing MCP surface is an explicit acceptance gap, not permission to use the GitHub function or database RPC directly. |
| Finance equity | `Navigation and editor` | `sabah-one-equity-mcp` (requires deployment and Equity OAuth approval) | Five semantic position tools; isolated from cash/banking and other MCP domains. See `finance-equity.md`. |
| Finance banking review and loans | Dated review and loan records | `sabah-one-finance-mcp` (requires deployment and Finance OAuth approval) | Two semantic review tools; independent of Equity and existing manual accounts. See `finance-banking-review.md`. |
| Tasks, Calendar, Knowledge, Prayer | Grounded capabilities vary by operation | Not yet published | Use Lina in the app; external agents stop at the missing MCP boundary. |
| Other Sabah One features | Surface-dependent | Not yet published | Treat external access as unavailable until a domain MCP contract is delivered and listed here. |
| Secrets | Intentionally unavailable | Intentionally unavailable | Secret plaintext remains outside assistant context and agent tools. |

## Employment MCP Requirement

The `sabah-one-employment-mcp` function exposes semantic tools for:

- `employment_list_applications` with bounded pipeline, work-type, remote-proof, and text filters;
- `employment_get_application` by stable ID;
- `employment_add_application` and `employment_update_application` with the fully-remote and UK/EMEA/global evidence fields;
- `employment_add_history` for contact and evidence events;
- `employment_remove_application` with explicit confirmation and an idempotency key.

The endpoint uses Supabase OAuth with PKCE and a separate account-owned Employment approval. The consent page requires an explicit choice of Inventory or Employment; client names and ordinary OAuth identity scopes never choose or broaden the data domain. Settings can revoke Employment access independently. Every tool checks that approval, and revoked, anonymous, direct browser, and other-account credentials fail closed at the MCP boundary.

Mutations use stable request IDs and narrow SQL operations on the existing Employment store. Retries preserve their original payload and ID; a changed payload cannot reuse a receipt. Browser edits use the same semantic operations, so an edit cannot replace the whole application list and discard a concurrent agent update. History additions preserve earlier evidence. Record only verified application and message facts; unknown roles, dates, remote eligibility, and compensation remain unknown.

The scheduled Codex jobs agent owns inbox reconciliation. It reads connected recruiting sources, lists existing applications, matches source evidence, adds missing applications or history, and reads back each change. It must not mark an email processed until the record is confirmed. A job advert is a lead, an interview update is not an offer, and an unlabelled platform update must not be assigned to a specific role by guesswork. Sabah One does not ingest Gmail itself or operate a second agent scheduler.

Connect the remote MCP URL `<Supabase project URL>/functions/v1/sabah-one-employment-mcp/mcp`, complete OAuth, and choose Employment on the Sabah One consent page. If that tool connection or its approval is unavailable, report the precise blocker and retain the source for reconciliation on the next run; direct database access, copied browser tokens, and UI automation remain prohibited fallbacks.

## Operational diagnostics boundary

Operational diagnostics add no account-owned database records or business-data API. The browser keeps a redacted memory-only timeline, cleared on account change, and sends fixed metadata envelopes to the first-party `operational-events` collector. The collector verifies a nonanonymous first-party session; OAuth client tokens cannot use it as a new domain capability. It never logs account identifiers, record contents, credentials, arbitrary messages or URLs. Its public health response contains release identity and collection mode only.

Operators inspect retained events through the existing authenticated Supabase operational Logs interface. External agents must use that governed operator interface for operational logs; this does not authorize account SQL, copied user tokens, or business-data UI access. Debug export is a local diagnostic convenience, not an external account-data interface. The existing domain MCP approvals and missing capabilities remain unchanged.

## Voice connection boundary

The ElevenLabs connection reference is a device preference, not new shared account data. Its selected Vault entry remains account-owned and is checked on every enabled synthesis request. The existing shared public voice ID behavior is unchanged. Secret management and plaintext remain intentionally outside agent tools; Inventory approval grants no voice or Settings access. External agents must not call Secrets RPCs or automate its UI. The narrow first-party speech endpoint returns audio only and respects the hosted AI pause.

## Daily goal progress controls

The Learn and Move switches only choose the amount passed to the existing first-party progress operation: the gap to the displayed level target by default, or one unit when “Add individual steps” is on. They are independent view-local controls, reset when the dashboard remounts, and add no shared data, schema, or new account operation. Progress continues through the established signed-in mutation path. This UI convenience does not change external agent access: Daily Learn and Move still have no published domain MCP, so external account reads and progress writes remain unavailable.

## Equity MCP requirement

The independent Equity domain exposes bounded list/get/add/update/remove position
tools at `sabah-one-equity-mcp/mcp`. Updates require the current `updatedAt`;
removal requires explicit confirmation; retryable writes carry stable UUID request
IDs. The browser uses the same semantic mutation RPCs. Complete separate Equity
OAuth approval before importing any private holdings. Inventory or Employment
consent never grants equity or banking access. Personal data is not seeded from
source code. Deployment, consent and private record readback are required for
acceptance; see [`finance-equity.md`](finance-equity.md).

## Page-scoped browser loading

`get_helm_account_snapshot_for_collections` is a first-party browser hydration
operation, with the same account, anonymous-session and OAuth-client denials as
the existing snapshot. It does not grant external agents a generic read API.
Activity pagination reads through the same first-party RLS boundary and changes
no business mutation or external MCP contract. Existing narrow domain MCPs and
listed missing-capability boundaries remain unchanged.

The first-party `get_helm_changed_collections` RPC returns only changed collection
names, the atomic account version, and a secret invalidation flag. It denies
anonymous and external OAuth-client sessions; the guarded definer read is needed
for protected Vault metadata and grants no secret-table access. This transport
optimization changes no business operation or external domain MCP contract.
