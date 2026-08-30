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
| Employment | Navigation only in this candidate | Not yet published | Do not read or mutate Employment account data externally. A dedicated Employment MCP approval and RPC boundary is required. |
| Tasks, Calendar, Finance, Knowledge, Prayer | Grounded capabilities vary by operation | Not yet published | Use Lina in the app; external agents stop at the missing MCP boundary. |
| Life Hero | Companion synchronizes account-owned evidence before reading its snapshot | Not yet published | KAN-262 is an explicit external-agent acceptance gap; agents cannot read or synchronize Life Hero through direct database, generic RPC, or UI fallbacks. |
| Other Sabah One features | Surface-dependent | Not yet published | Treat external access as unavailable until a domain MCP contract is delivered and listed here. |
| Secrets | Intentionally unavailable | Intentionally unavailable | Secret plaintext remains outside assistant context and agent tools. |

## Life Hero MCP Acceptance Gap

KAN-262 materially changes account-derived Life Hero evidence, but this bounded ticket does not publish a new external provider or MCP surface. A later dedicated Life Hero MCP contract must provide an owner-scoped snapshot read and a bounded evidence synchronization operation, derive account identity from OAuth, preserve the existing anonymous-user denial and idempotency rules, and include focused contract and denial tests. Until that contract is implemented, deployed, and approved, external agents must stop at this documented gap.

## Employment MCP Requirement

The Employment tracker requires semantic tools for:

- `employment_list_applications` with bounded pipeline, work-type, remote-proof, and text filters;
- `employment_get_application` by stable ID;
- `employment_add_application` and `employment_update_application` with the fully-remote and UK/EMEA/global evidence fields;
- `employment_add_history` for contact and evidence events;
- `employment_remove_application` with explicit confirmation and an idempotency key.

The endpoint must use its own consent text and approval scope. Reusing the Inventory approval would silently broaden existing authorization and is forbidden. Until that dedicated OAuth/RPC boundary is implemented, tested, deployed, and approved, agents must not mutate Employment through another route.
