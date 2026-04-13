# Assistant Conversational Architecture

## Goal

Make Lina feel like a real GPT-5.4-powered personal assistant:

- the model understands the user's intent first
- the model chooses grounded HELM actions or asks for clarification
- local code validates, confirms, and executes safely
- the model writes the visible reply from verified results

This document describes the shipped conversational runtime that replaced the older planner-text-plus-executor-copy flow.

## Core Rule

GPT is the conversational brain.

Local code is the safety and execution layer.

That means:

1. the model is first for intent recognition
2. the model decides whether the turn is `reply`, `clarify`, `confirm`, or `tool_calls`
3. HELM validates grounded ids, time resolution, action availability, and confirmation rules
4. HELM executes deterministically
5. the model narrates the verified outcome

Planner text and executor templates are not meant to be shown directly to the user.

## Turn Lifecycle

### 1. Normalize the transcript

Local preprocessing is allowed for:

- transcript cleanup
- correction-memory application
- current-surface context
- recent-entity context
- timezone and current-time context

This layer does not choose the action.

### 2. Build the grounded planning bundle

For every new turn, HELM builds a bundle that includes:

- relevant capability candidates from `src/assistant/capabilities.ts`
- grounded entity candidates with stable ids
- temporal candidates
- current surface
- recent entities and recent plans
- benchmark examples for similar requests
- pending confirmation context when applicable

### 3. Ask the model for the turn type

The model receives:

- the planning bundle
- the allowed tool schemas
- recent conversation history
- pending confirmation state when one exists

The model must return one of:

- `reply`
- `clarify`
- `confirm`
- `tool_calls`

### 4. Validate locally

Local validation is responsible for:

- unknown capability rejection
- arg-shape validation
- grounded id verification
- time grounding
- unsupported-action blocking
- contradiction checks such as destructive intent returning navigation

If the plan is not safe, Lina clarifies instead of approximating.

### 5. Store confirmations as executable batches

Pending confirmations are stored as:

- validated tool-call batches
- grounded entity references
- planning source and model metadata

Short replies like `Yes.`, `Okay.`, and `Yeah, that's the one.` resolve locally.

Replies that are not explicit yes-or-no go back through the model with the pending confirmation context so Lina can repair or retarget the action instead of collapsing into a replan loop.

### 6. Execute locally

Executors return structured facts only:

- capability
- call id
- execution status
- changed entity ids
- navigation payloads
- undo metadata
- verification facts
- failure or clarification reasons

Executors do not own the final user-facing wording.

### 7. Narrate from verified results

After execution, the model receives verified turn facts and writes the visible reply.

This is what makes Lina sound like GPT instead of a router:

- natural clarifications
- natural confirmations
- natural post-execution replies

If model narration is unavailable, HELM falls back truthfully and minimally.

## Provider Contract

### Hosted GPT-5.4

Hosted GPT-5.4 is the primary path.

The Supabase Edge Function in `supabase/functions/assistant-openai/` now supports a tool-capable `turn` action:

- client sends messages, response schema, and tools
- tool definitions use OpenAI-safe function names and are mapped back to HELM capability ids after the response
- model returns text or tool calls
- HELM validates and executes
- HELM performs a narration pass for the final reply

### Ollama

Ollama follows the same orchestration envelope when available.

It remains model-backed, not regex-backed. If a live model path is unavailable, Lina refuses to guess.

## Shared Runtime

Chat and voice both use the same assistant runtime:

- `src/services/assistantRuntime.ts`
- `src/assistant/runtime.ts`

They share:

- planning
- confirmation
- validation
- execution
- narration
- dialog state

This avoids drift between chat and voice behavior.

## Debug And Observability

The Debug surface now exposes the full conversational trace:

- original transcript
- effective transcript
- planning bundle
- raw planner response
- model turn
- tool calls
- validator verdict
- validated plan
- pending confirmation
- execution payloads
- raw narration response
- final assistant message

This keeps failures diagnosable without guessing which layer spoke.

## Safety Boundaries

The runtime keeps these hard rules:

- no destructive action without confirmation when the capability requires it
- no unsupported action approximation
- no guessing when no live AI provider is available
- no claim of success before deterministic execution succeeds
- no user-visible raw planner JSON
- no user-visible executor template strings as the normal reply path

## Internal Compatibility

`ActionPlan` still exists as an internal compatibility shape for validation, debug visibility, and tests.

It is no longer the user-facing conversational contract.

The user-facing contract is the orchestration envelope plus the narrated assistant message.

## Release Expectations

Every release of this runtime should keep:

- voice and chat on the same runtime path
- model-first intent recognition
- deterministic validation and execution
- narration from verified results
- benchmark enforcement before deployment
