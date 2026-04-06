# Jarvis-Style Command Understanding For Lina

## Core Recommendation

The smartest path is to stop asking the model to infer commands from raw text with hardcoded action words, and instead give it a grounded command runtime.

In this codebase, that means replacing the duplicated keyword and tag parsing in:

- `src/services/voiceAssistant.ts`
- `src/store/contexts/ChatContext.tsx`

with one shared planner/executor pipeline used by both voice and chat.

## Why The Current Approach Will Hit A Ceiling

Hardcoded action words are brittle because they confuse wording with intent.

Examples:

- "Move my 3pm to tomorrow" and "push that meeting to tomorrow" are the same intent with different wording.
- "Remind me after Maghrib" cannot be handled well by simple verbs.
- "Mark that one done" depends on conversational context, not just words.

Expanding the verb list will make the system larger, not smarter.

## The Right Architecture

### 1. Capability Registry

Create a shared registry of high-level app actions with:

- a stable capability id
- a strict input schema
- examples
- preconditions
- confirmation rules
- a deterministic executor

Examples:

- `calendar.create_event`
- `calendar.reschedule_event`
- `tasks.create_task`
- `tasks.complete_matching`
- `finance.record_transaction`
- `knowledge.create_entry`
- `navigation.go_to_surface`

Important: do not expose low-level arbitrary mutations as the primary interface. Prefer semantic business actions over generic CRUD.

### 2. Entity Resolver

Build a resolver over live app state so the assistant can map language onto real objects.

It should index:

- tasks
- events
- calendars
- accounts
- goals
- knowledge entries
- workspaces
- visible UI items
- recently mentioned items

Ranking should combine:

- exact alias match
- fuzzy text match
- recency
- current-surface bias
- embedding similarity

This is what makes commands like "move it", "that task", and "my work calendar" actually usable.

### 3. Temporal Resolver

The model should not output vague time prose as the final result.

It should output semantic time references that are resolved deterministically using:

- current date
- timezone
- locale
- prayer times
- business rules

Examples:

- "tomorrow after lunch"
- "next Friday morning"
- "before Maghrib"
- "after Dhuhr"

These should resolve to exact timestamps or bounded windows before execution.

### 4. Structured Planning

Replace text tags like:

- `[ADD_TASK: ...]`
- `[COMPLETE_TASK: ...]`
- `[NAV: ...]`

with a strict `ActionPlan` JSON schema.

The model should only be allowed to produce one of four modes:

- `answer`
- `clarify`
- `confirm`
- `act`

Example:

```ts
type ActionPlan = {
  mode: 'answer' | 'clarify' | 'confirm' | 'act'
  response: string
  steps: Array<{
    capability: string
    args: Record<string, unknown>
  }>
}
```

This makes the system inspectable, testable, and far safer than free-form parsing.

### 5. Transactional Executor

Once a plan is produced:

1. Resolve referenced entities.
2. Validate arguments against capability schemas.
3. Check confirmation rules.
4. Execute steps deterministically.
5. Verify postconditions.
6. Return a result plus an undo token where possible.

If confidence is low, ambiguity remains, or the action is destructive, the assistant should ask before mutating state.

### 6. Teaching Loop

When the user corrects Lina, store:

- the accepted phrasing
- the resolved intent
- aliases
- chosen entities
- final successful plan

Retrieve these examples in future turns so the system adapts to the user's language without hardcoding more verbs.

### 7. Eval Harness

Build an evaluation suite from real commands.

Target:

- 200 to 500 representative utterances
- expected `ActionPlan`
- expected final state changes

No prompt or model change should ship unless it passes this benchmark.

This is how the system becomes reliably "Jarvis-like" instead of only sounding smart in demos.

## Why This Is Better Than The Alternatives

### Bigger Keyword Lists

Not good enough. They expand surface area but do not solve ambiguity, context, reference resolution, or flexible phrasing.

### Pure Free-Form LLM Parsing

Also not enough. The model may hallucinate actions, invent entities, or produce arguments that are not executable.

### UI Automation

Wrong abstraction for your own app. Lina should operate on semantic app tools, not click buttons like a blind robot.

## What Creates The "Jarvis" Feeling

The "Jarvis" effect comes from grounded context, not just a more powerful model.

The assistant must understand:

- what is on screen
- what was just mentioned
- what objects exist in the app
- what time expressions mean right now
- when to clarify
- when to confirm
- how to execute reliably

That is what lets commands such as these work naturally:

- "Move it to tomorrow after lunch."
- "Add this to my work calendar."
- "Mark that done and remind me before Maghrib."
- "Create a task from this and schedule time for it next week."

## What To Build In This Repo

The first implementation move should be:

1. Remove the hardcoded action-word parser in `src/services/voiceAssistant.ts`.
2. Remove the action-tag protocol in `src/store/contexts/ChatContext.tsx`.
3. Replace both with one shared assistant runtime.

Suggested module layout:

- `src/assistant/capabilities.ts`
- `src/assistant/entityResolver.ts`
- `src/assistant/temporalResolver.ts`
- `src/assistant/plannerSchema.ts`
- `src/assistant/planner.ts`
- `src/assistant/executor.ts`
- `src/assistant/dialogState.ts`

## Product Bet

If this system is meant to feel truly intelligent, the product should not be bet on a bigger list of verbs.

It should be bet on:

- one unified assistant engine for voice and chat
- schema-constrained planning
- high-level business capabilities
- hybrid entity retrieval
- deterministic execution
- confirmation and undo
- learning from corrections
- evaluation against real commands

## Model Fit

This design fits the current local-first stack well.

Relevant Ollama references:

- [Structured outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [Tool support](https://ollama.com/blog/tool-support)
- [Qwen3 model library](https://ollama.com/library/qwen3)
- [Qwen3 embedding model](https://ollama.com/library/qwen3-embedding%3A4b)

## Final Recommendation

Do not evolve the current command parser incrementally.

Replace it with a grounded capability graph plus:

- structured planning
- entity resolution
- temporal resolution
- deterministic execution
- memory from corrections
- evaluation from real usage

That is the highest-upside path to making Lina feel less like a chatbot with commands and more like a true assistant.
