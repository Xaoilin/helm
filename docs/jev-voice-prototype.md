# Jev voice prototype

Product decision: on 2026-10-09 Sabah requested a new, opt-in voice prototype for
page navigation, item finding, and adding/completing tasks, with Deepgram
streaming for Brave. This is separate from the retired Lina/Chat/Life Hero work.

Open **Jev voice** in the signed-in website. Save two `api_key` secrets labelled
**TypeSafe** and **Deepgram** in Secrets, then select them in the panel. The
Deepgram key needs Member permission to grant temporary tokens. Typed commands
need only TypeSafe. Enable the microphone and allow browser permission to speak.

Examples: “Hey Sabah, open Calendar, over”, “Hey Sabah, find my printer, over”,
and “Hey Sabah, add a task to buy milk, over”. Adding/completing a task previews
the exact title and needs **Confirm** or “confirm over”; **Cancel** discards the
preview. The planner service confirms changes before the app shows success.
Prayer completion, deletion, bulk commands, dates/priorities and conversational
answers are outside this prototype.

“Hey Sabah” and waiting for “over” are enabled by default. Speech recognition
continues across pauses; its interim transcript cannot execute an action. The
mic stops on Stop/close, account change, a hidden tab, offline mode, Secrets or a
five-minute session limit. Streaming has no automatic reconnect. Navigation can
open Secrets, which immediately pauses commands and releases the mic.

## Runtime and cost

The browser streams microphone audio to Deepgram Nova-3, using a 30-second
connection token minted by `sabah-one-jev-voice`. Long-lived provider keys are
resolved server-side using the caller's existing account-owned Vault RPCs and
never returned to the browser. The temporary token, transcript and preview stay
in memory. No recording, transcript or account-data cache is persisted.

The same authenticated Edge Function calls TypeSafe's pinned `jev-1.13.0` model
once for parallel closed-set choices. It sends the command, current page and up
to 200 candidate names from Tasks, Inventory, Projects and Knowledge; it sends
no descriptions, secret contents, finance records or credentials. The model
selects only supplied pages, IDs and verbatim title spans. Code checks confidence,
probability, eligibility and duplicate task names before offering an action.
The first-party browser performs a confirmed task write through the existing
planner API; the model receives no account mutation capability.

The panel reports the server-measured Jev round trip and input tokens. Cost is
an estimate at $0.042 per million input tokens, with speech excluded. Deepgram
bills for streaming while the mic is on, including waiting for a wake word.

## Evidence and acceptance boundary

Real Jev checks using synthetic commands selected an add-task title in 330 ms
(1,036 input tokens, estimated $0.000044), navigation, completion and a negated
request. The final five-choice protocol selected Printer in 437 ms and the
existing Buy milk task for completion in 248 ms (1,030 input tokens each,
estimated $0.000043 each). Finding and completion use separate choices because
the first combined item selector produced uncertain decisions. These are provider
decision timings, not microphone-to-action
latency or a guarantee of future speed. The original demonstration is
[Kevin Badi's jev-voice](https://github.com/kevinbadi/jev-voice); a browser example
is [Moritz's jev-voice-browser](https://github.com/moritzkremb/jev-voice-browser).

`src/test/jevVoice.test.ts` covers decisions, account-scoped key resolution and
provider HTTP contracts. `src/test/deepgramSpeech.test.ts` covers cancellation,
duplicate final results and resource release. `e2e/jev-voice.spec.ts` uses synthetic
provider responses and contract-validated service fixtures to check navigation,
finding, confirmed writes, refusal, voice cues and 320/768/1440px interactions.
Those fixtures do not prove a paid Deepgram connection or real Brave microphone
recognition. Full voice acceptance still needs account-owned provider keys and
a live microphone run in Brave.

External Task and Knowledge agent MCP capabilities remain missing and are an
explicit acceptance blocker for graduating this prototype to general agent
access. This first-party command selector is not an external MCP service;
agents must not copy sessions, drive a person's UI or call account APIs as a
workaround. See [agent access](agent-access.md).

Protocol sources: [TypeSafe API](https://docs.typesafe.ai/api),
[models and pricing](https://docs.typesafe.ai/models),
[Deepgram token grants](https://developers.deepgram.com/guides/fundamentals/token-based-authentication),
[streaming API](https://developers.deepgram.com/reference/speech-to-text/listen-streaming),
and [Deepgram's browser bearer subprotocol implementation](https://github.com/deepgram/deepgram-js-sdk/blob/main/src/CustomClient.ts).
