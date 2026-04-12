# Assistant Command Architecture

## Goal

Make Lina understand and execute app commands in a way that feels conversational, contextual, and reliable, while staying grounded in real app state.

## Current Runtime

The current implementation now routes both chat and voice through a shared assistant runtime under `src/assistant/`.

Implemented pieces:

- a source-of-truth assistant action registry with per-action status, domain, args, examples, aliases, and executor metadata
- schema-validated `ActionPlan` planning
- a shared capability registry
- entity resolution for surfaces, tasks, events, calendars, accounts, and knowledge topics
- temporal resolution for relative dates, clock times, part-of-day phrases, and basic prayer-based references
- normalized task-request parsing that strips conversational scaffolding before writes
- deterministic execution for navigation, task creation/reveal/completion/deletion, calendar creation/rescheduling, finance logging, and knowledge entry creation
- shared dialog state with confirmation handling for risky actions such as event rescheduling
- typed assistant navigation requests so Lina can open the Tasks surface to `Today`, `All Tasks`, or `Goals`, optionally reset filters, and optionally reveal and highlight a specific task
- model-first structured planning through hosted OpenAI or local Ollama instead of action-tag parsing
- grounded ID-based validation for task reveal, task complete, task delete, calendar reschedule, finance account selection, and knowledge topic selection
- benchmark example retrieval from a 200-plus command corpus
- expanded debug traces that capture the planning bundle, raw planner response, validator verdict, validated plan, and execution payloads

Still intentionally lightweight:

- entity ranking is heuristic and local-first rather than embedding-backed
- prayer-based time resolution uses the currently loaded prayer snapshot only
- exact transcript corrections such as "No, I said ..." now persist as local-first assistant memory, but a broader teaching-loop memory and richer semantic reuse are still future work

## Shipped Cutover

The shipped runtime now uses the model as the first planner for new chat and voice intents.

Local code still matters, but only for the layers that should remain deterministic:

- transcript normalization
- correction-memory application
- capability retrieval
- grounded entity and time candidate retrieval
- validator guardrails
- confirmation handling
- deterministic execution
- debug tracing

There is no longer a supported local regex action-selection path for fresh assistant turns. If no live planner is available, Lina refuses to guess.

## Recommended Direction

Use structured outputs from hosted OpenAI or local Ollama as the transport layer, but place them inside a grounded runtime with deterministic execution.

The architecture should combine:

- high-level capabilities
- entity resolution over live app data
- temporal resolution
- schema-constrained planning
- transactional execution
- confirmation and undo
- learning from corrections
- an evaluation harness built from real commands

Tool calling alone is not enough. Keyword matching alone is not enough. The system needs both a model-facing planning surface and an app-facing execution surface.

## Core Design

### 1. Capability registry

Create a shared registry of semantic app actions.

Each capability should define:

- a stable capability id
- a lifecycle status such as `live`, `planned`, or `disabled`
- a domain owner such as navigation, tasks, calendar, finance, or knowledge
- a strict input schema
- examples and aliases
- plain-language examples
- preconditions
- confirmation requirements
- a deterministic executor
- an executor key for debug visibility
- debug metadata rendered in the Debug surface
- postcondition checks where possible

Examples:

- `navigation.go_to_surface`
- `tasks.open_view`
- `tasks.create_task`
- `tasks.reveal_task`
- `tasks.complete_matching`
- `tasks.delete_matching`
- `calendar.create_event`
- `calendar.reschedule_event`
- `finance.record_transaction`
- `knowledge.create_entry`

Prefer business actions over generic low-level mutations. The assistant should ask to "reschedule an event", not receive raw permission to patch arbitrary state.

### 2. Entity resolver

Build a resolver over live app state so the assistant can bind language to actual objects.

The resolver should index:

- tasks
- habits
- events
- calendars
- accounts
- goals
- knowledge entries
- workspaces
- currently visible UI items
- recently mentioned entities

Ranking should combine:

- exact alias match
- fuzzy text match
- recency
- current-surface bias
- embedding similarity

This is what makes commands like "move it", "that task", and "my work calendar" viable.

### 3. Temporal resolver

The planner should not leave vague time prose unresolved.

Resolve phrases like:

- tomorrow after lunch
- next Friday morning
- before Maghrib
- after Dhuhr

Resolution should be deterministic and use:

- current date
- timezone
- locale
- prayer-time data
- product rules such as working-hour defaults

### 4. Structured planner

Replace action tags such as:

- `[NAV:...]`
- `[ADD_TASK:...]`
- `[COMPLETE_TASK:...]`

with a strict plan object.

Example:

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

The exact schema can evolve, but the planner must stay structured, inspectable, and easy to test.
For hosted OpenAI structured outputs, strict nested objects must keep every declared arg key in `required`; semantically optional args should be represented as nullable fields instead of being omitted from the strict schema.

Task creation is now intentionally stricter than the earlier regex-only path:

- polite scaffolding such as "can you", "for me to", "called", and "new task" should be stripped from the saved title
- vague follow-ups such as "create the task now" should clarify instead of silently creating junk records
- create-event phrasing should not be hijacked by task creation heuristics

### 5. Transactional executor

Execution should follow a deterministic pipeline:

1. validate the plan shape
2. resolve entity references
3. resolve temporal expressions
4. check preconditions and confirmation rules
5. execute the capability steps
6. verify postconditions
7. return a final result and undo metadata where feasible

If confidence is low, the target is ambiguous, or the action is destructive, Lina should clarify or confirm before mutating state.

For write actions, Lina should only describe success after the deterministic local mutation succeeds. For reveal actions, the executor should pass a typed navigation request that allows the UI to open the correct tab, clear restrictive filters, and highlight the resolved entity.
For view-only task navigation, the executor should use the same typed Tasks surface-state payload even when no task id is involved so "show me all my tasks" is explicit and testable instead of being approximated to a generic surface jump.

### 6. Dialog state

Keep a lightweight dialog state shared by voice and chat so the assistant can interpret:

- "that one"
- "move it"
- "the second event"
- "use my work calendar"

Dialog state should track recent entities, recent plans, current surface, and recent clarifications.

### 7. Teaching loop

When the user corrects Lina, store:

- the user's phrasing
- the final accepted meaning
- aliases
- selected entities
- the successful plan

Retrieve these examples in future turns so the system adapts to the user's language without hardcoding more verbs.

The current implementation now covers a lightweight version of this for transcript correction:

- exact utterance corrections such as "No, I said delete all of the tasks related to mirrors"
- phrase replacements derived from that correction, such as `minors` -> `mirrors`
- local-first persistence shared by chat and voice

Broader semantic teaching, plan reuse, and larger evaluation coverage are still future work.

## Debug Visibility

The Debug surface should render the assistant action registry directly from code and show the latest assistant trace:

- transcript and effective transcript
- structured `ActionPlan`
- executed steps
- typed navigation payloads

This makes unsupported gaps visible before they become user-facing surprises.

### 8. Evaluation harness

Build a benchmark from real commands.

Current shipped coverage:

- 200-plus representative utterances in `src/assistant/evals/benchmarkCorpus.ts`
- benchmark dialog seeds plus grounded-id expectations for destructive, referential, and other grounded cases
- expected plan mode
- expected capability family
- no-approximation coverage for unsupported and destructive intents
- a runnable benchmark scorer in `scripts/run-assistant-benchmark.ts`
- threshold enforcement on `master` before deployment: 100% destructive, 100% unsupported no-approximation, and 98% overall benchmark pass rate

Prompt or model changes should not ship unless they improve or preserve benchmark results.

## Why This Beats The Alternatives

### Bigger keyword lists

This increases maintenance cost without solving ambiguity, reference resolution, or context.

### Pure free-form prompting

This can sound smart while still hallucinating entities, inventing actions, or skipping confirmation boundaries.

### UI automation

That is the wrong abstraction for an app we own. Lina should work with semantic app capabilities, not approximate user clicks.

## Tool Calling's Actual Role

Hosted OpenAI or Ollama structured planning is still useful, but it should be the transport between the model and the capability runtime, not the entire design.

The shipped runtime now follows this shape:

1. retrieve relevant capabilities, entities, and examples
2. ask the model for a structured plan or tool call
3. validate and ground the result locally
4. execute deterministically
5. generate the final user-facing response from verified results

For read actions, a second response pass can turn structured results into natural language. For writes, success should be described only after execution and verification.

## Proposed Module Layout

Suggested starting structure:

- `src/assistant/capabilities.ts`
- `src/assistant/entityResolver.ts`
- `src/assistant/temporalResolver.ts`
- `src/assistant/dialogState.ts`
- `src/assistant/plannerSchema.ts`
- `src/assistant/planner.ts`
- `src/assistant/executor.ts`
- `src/assistant/evals/`

Both `voiceAssistant.ts` and `ChatContext.tsx` should delegate to this shared runtime rather than continue to own separate command systems.

## Cutover Status

The model-first cutover is now shipped:

- chat and voice share one assistant runtime under `src/assistant/`
- fresh intents are planned by a live hosted or Ollama model first
- local code validates, grounds, confirms, and executes
- destructive or unsupported requests clarify instead of approximating to another action
- when no live planner is available, Lina responds truthfully and executes nothing

## Design Principles

- one assistant runtime for both voice and chat
- semantic capabilities instead of raw state patches
- model-first planning with local deterministic validation and execution
- confirmation for risky actions
- undo where practical
- benchmark-driven iteration

## Final Recommendation

Do not keep evolving the current command parser incrementally.

Replace it with a grounded capability runtime that uses tool calling and structured planning, resolves real entities and time expressions, executes deterministically, learns from corrections, and is measured against a real command benchmark.
