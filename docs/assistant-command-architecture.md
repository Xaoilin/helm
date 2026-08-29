# Assistant Command Architecture

## Goal

Lina should understand and execute app commands conversationally, while staying grounded in real signed-in Sabah One state. Chat and Voice use one grounded assistant runtime; they never maintain separate command systems or mutation paths.

For the turn-by-turn contract, see `docs/assistant-conversational-architecture.md`.

Lina is the in-app agent layer. External AI agents use domain-scoped MCP tools under the separate contract in [`agent-access.md`](agent-access.md); they must not automate Lina's UI or call account storage directly.

## Current Runtime

The shipped runtime in `src/assistant/` provides:

- a source-of-truth capability registry with lifecycle status, domain, arguments, examples, aliases, preconditions, confirmation rules, and executor metadata;
- schema-validated planning and grounded entity resolution for surfaces, tasks, projects, events, calendars, accounts, and Knowledge topics;
- temporal resolution for relative dates, clock times, part-of-day phrases, and supported prayer references;
- deterministic execution for navigation, task, calendar, finance, Inventory, and Knowledge actions;
- shared confirmation, typed navigation, pending prayer completion, activity recording, and supported undo;
- hosted GPT planning and narration through the `assistant-openai` Supabase Edge Function, or the configured Ollama endpoint;
- debug traces and a representative benchmark corpus.

When no configured planner is available, Lina gives a truthful in-app fallback and executes nothing. Direct app surfaces remain available.

## Core Design

### 1. Capability registry

Each semantic capability defines:

- a stable capability ID and lifecycle status such as `live`, `planned`, or `disabled`;
- a domain owner and strict input schema;
- examples, aliases, preconditions, and confirmation requirements;
- a deterministic executor, executor key, and postcondition checks where possible.

Business actions are preferred over generic patches. Examples include `navigation.go_to_surface`, `tasks.create_task`, `tasks.complete_matching`, `calendar.reschedule_event`, `finance.record_transaction`, `inventory.adjust_quantity`, and `knowledge.create_entry`.

### 2. Entity resolver

The resolver indexes live account data, the current surface, recently mentioned entities, and relevant Projects, Tasks, Events, Calendars, Accounts, Goals, Inventory records, and Knowledge entries. Ranking may combine exact alias match, fuzzy text match, recency, current-surface bias, and embedding similarity.

Grounded IDs are required for reveal, completion, deletion, rescheduling, finance-account selection, and Knowledge-topic selection. Ambiguous or missing entities produce clarification instead of a guessed mutation.

### 3. Temporal resolver

The planner must resolve phrases such as `tomorrow after lunch` and `next Friday morning` against the current date, effective account app zone, locale, and product rules. Prayer phrases such as `before Maghrib` and `after Dhuhr` use the timetable's validated schedule zone separately. Nonexistent daylight-saving wall time remains unresolved rather than being silently shifted.

### 4. Structured planner

Hosted GPT returns a strict structured turn rather than action tags such as `[ADD_TASK:...]`. The internal compatibility shape remains inspectable and testable:

```ts
type ActionPlan = {
  mode: 'answer' | 'clarify' | 'confirm' | 'act'
  response: string
  confidence: number
  steps: Array<{
    capability: string
    args: Record<string, unknown>
    unresolved?: string[]
    requiresConfirmation?: boolean
  }>
}
```

Strict hosted schemas keep every declared argument required; semantically optional arguments are represented as nullable fields. Task creation strips conversational scaffolding, clarifies vague requests, and does not let task heuristics hijack event phrasing.

### 5. Transactional executor

Execution follows a deterministic pipeline:

1. validate the plan shape;
2. resolve entity and time references;
3. check preconditions and confirmation rules;
4. execute capability steps through the account mutation boundary;
5. verify postconditions;
6. record an account-backed activity entry;
7. return verified facts and undo metadata where feasible.

For destructive or ambiguous actions, Lina clarifies or confirms first. She describes success only after the mutation and verification succeed. Reveal actions return typed navigation data so the UI can open the right view, clear restrictive filters, and highlight the resolved entity.

Prayer completion is a domain-owned exception to binary task completion. An omitted status creates a typed pending action and asks `On time or late?`; the in-app follow-up resolves it without a second model request. The shared prayer mutation updates task state, gamification, and canonical prayer tracking once.

### 6. Dialog state

Shared dialog state tracks recent entities, recent plans, current surface, recent clarifications, and pending confirmation or prayer actions. Short explicit confirmation replies resolve a stored validated batch; ambiguous replies return to the hosted model with context.

### 7. Teaching loop

When a user corrects Lina, account-backed assistant memory may store the phrasing, accepted meaning, aliases, selected entities, and successful plan. Exact transcript corrections such as `No, I said ...` are shared between Chat and Voice. Broader semantic teaching and richer plan reuse remain future work.

## Debug Visibility And Evaluation

Debug renders the capability registry and the latest trace: transcript, effective transcript, planning bundle, model response, turn type, validator verdict, pending confirmation, execution facts, narration, and typed navigation payloads. Secret values and tokens are excluded.

The benchmark corpus contains representative utterances, dialog seeds, grounded-ID expectations, destructive cases, and unsupported-action no-approximation cases. The hosted benchmark is enforced before Pages exposure with thresholds of 100% destructive coverage, 100% unsupported no-approximation coverage, and 98% overall pass rate.

## Why This Beats The Alternatives

### Bigger keyword lists

They increase maintenance cost without solving ambiguity, reference resolution, or context.

### Pure free-form prompting

It can sound smart while hallucinating entities, inventing actions, or skipping confirmation boundaries.

### UI automation

It is the wrong abstraction for an app we own. Lina should use semantic capabilities and account boundaries, not approximate clicks.

The same rule applies to external agents: use a published Sabah One MCP capability or report that the domain is unavailable.

## Module Layout

- `src/assistant/capabilities.ts`
- `src/assistant/entityResolver.ts`
- `src/assistant/temporalResolver.ts`
- `src/assistant/dialogState.ts`
- `src/assistant/plannerSchema.ts`
- `src/assistant/planner.ts`
- `src/assistant/executor.ts`
- `src/assistant/evals/`

## Design Principles

- one assistant runtime for Chat and Voice;
- hosted model-first intent recognition with deterministic browser validation and execution;
- semantic capabilities instead of raw state patches;
- confirmation for risky actions and undo where practical;
- account-backed audit entries for assistant mutations;
- truthful in-app fallback when hosted planning is unavailable;
- benchmark-driven iteration and claim-matched evidence.
