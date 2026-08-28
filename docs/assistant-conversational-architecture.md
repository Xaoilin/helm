# Assistant Conversational Architecture

## Goal

Make Lina feel like a GPT-5.4-family-powered personal assistant while keeping every action grounded in current Sabah One account state:

- the configured live planner understands intent first;
- the model chooses grounded actions or asks for clarification;
- browser code validates, confirms, and executes safely;
- the model writes the visible reply from verified results.

This is the shipped conversational runtime for both Chat and Voice.

## Core Rule

A configured hosted GPT or Ollama planner is the conversational brain. Browser code is the deterministic safety and execution layer.

1. The model recognizes intent.
2. The model returns `reply`, `clarify`, `confirm`, or `tool_calls`.
3. Sabah One validates grounded IDs, time resolution, action availability, and confirmation rules.
4. Sabah One executes approved semantic capabilities.
5. The model narrates the verified outcome.

Planner transport and executor summaries are internal; raw plan data is never the normal user-facing reply.

## Turn Lifecycle

### 1. Normalize the transcript

Browser preprocessing may provide transcript cleanup, correction-memory application, current-surface context, recent-entity context, and timezone/current-time context. This layer does not choose the action.

### 2. Build the grounded planning bundle

For every new turn, Sabah One supplies:

- relevant capability candidates from `src/assistant/capabilities.ts`;
- grounded entity candidates with stable IDs;
- temporal candidates;
- current surface and recent conversation context;
- benchmark examples for similar requests;
- pending confirmation context when applicable.

### 3. Ask the configured planner for the turn type

The selected hosted GPT or Ollama planner receives the planning bundle, allowed tool schemas, conversation history, and any pending confirmation state. It must return one of `reply`, `clarify`, `confirm`, or `tool_calls`.

### 4. Validate in the browser

Browser validation rejects unknown capabilities, malformed arguments, ungrounded IDs, unresolved times, unsupported actions, and contradictions such as a destructive intent returning navigation. If the plan is unsafe, Lina clarifies instead of approximating.

### 5. Store confirmations as executable batches

Pending confirmations contain validated tool-call batches, grounded entity references, and planning metadata. Short replies such as `Yes`, `Okay`, and `Yeah, that's the one` can resolve the existing batch. Ambiguous replies return to the hosted model with the pending context so Lina can repair or retarget the action.

### 6. Execute deterministically

Executors return structured facts only:

- capability and call ID;
- execution status;
- changed entity IDs;
- typed navigation payloads;
- undo metadata;
- verification facts;
- failure or clarification reasons.

The shared account mutation boundary records assistant activity for supported writes. Prayer completion remains a domain-owned action and asks `On time or late?` when the user did not specify an outcome.

### 7. Narrate from verified results

After execution, the selected planner receives verified turn facts and writes the visible reply. If narration is unavailable, Sabah One uses a truthful, minimal in-app fallback and does not claim an unverified success.

## Hosted Provider Contract

The `assistant-openai` Supabase Edge Function supports a tool-capable `turn` action:

- the browser sends messages, response schema, and allowed tools;
- Settings may select one of the supported hosted GPT-5.4-family presets;
- tool definitions use provider-safe names and map back to Sabah One capability IDs;
- the hosted model returns text or tool calls;
- Sabah One validates, executes, and performs a narration pass from verified facts.

The OpenAI key remains in the Edge Function environment and never enters the browser. If the hosted function or model is unavailable, Lina presents an in-app unavailable state, refuses to guess, and leaves direct app surfaces available.

## Ollama Provider Contract

When Settings selects Ollama, the browser sends the same structured planning and narration requests to the configured Ollama HTTP endpoint. Auto may use it when hosted planning is unavailable. Ollama never bypasses grounding, confirmation, deterministic execution, or verified-result narration; if the endpoint is unreachable, Lina refuses to guess.

## Shared Runtime

Chat and Voice use the same assistant runtime in `src/services/assistantRuntime.ts` and `src/assistant/runtime.ts`. They share planning, confirmation, validation, execution, narration, dialog state, correction memory, activity recording, and undo behavior.

## Debug And Observability

The Debug surface exposes the conversational trace:

- original and effective transcript;
- planning bundle and model turn;
- tool calls and validator verdict;
- validated plan and pending confirmation;
- execution payloads and verification facts;
- narration response and final assistant message.

This keeps failures diagnosable without guessing which layer spoke. Tokens and secret values are excluded.

## Safety Boundaries

- No destructive action without the capability's required confirmation.
- No unsupported-action approximation.
- No guessing when no live configured planner is available.
- No success claim before deterministic execution and verification succeed.
- No raw planner JSON or executor template strings as the normal visible reply.
- No second mutation path for Voice.

## Internal Compatibility

`ActionPlan` remains an internal validation, debug, and test shape. The user-facing contract is the hosted orchestration envelope plus the narrated assistant message.

## Deployment Expectations

Every hosted deployment that changes this runtime keeps Chat and Voice on the same path, validates deterministic execution, narrates from verified results, and enforces the assistant benchmark before Pages exposure. Benchmark results are evidence for the corpus and provider path they exercise, not proof of every conversation.
