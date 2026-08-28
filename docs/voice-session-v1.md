# Voice Session V1

## Goal

Make Lina conversational after the browser wake word without turning the page into an always-listening duplex conversation.

V1 is intentionally turn-based:

1. The user says `Hey Lina`.
2. Lina speaks a short acknowledgement.
3. Lina listens for one spoken turn.
4. The shared grounded assistant runtime processes the request with the configured live planner.
5. Lina speaks the answer.
6. Lina reopens the microphone for a follow-up turn.
7. The session ends on silence, a stop phrase, or a manual close.

## Scope

V1 covers spoken acknowledgement, an explicit microphone-ready cue, hands-free turn-taking, live transcript preview, automatic microphone reopening, spoken stop phrases, silence-based ending, Chat history for wake-word sessions, and a Settings toggle that can turn Lina off without removing Chat.

V1 does not attempt full duplex conversation, interruption while Lina is speaking, background listening without a wake word, or provider-specific streaming audio.

## State Model

The voice assistant keeps these UI states:

- `idle`
- `open`
- `preparing`
- `listening`
- `processing`
- `speaking`

V1 also tracks the session mode (`manual` or `handsfree`) and whether a listening turn is `initial` or `followup`.

## Session Flow

### Wake word start

When the browser wake word fires and voice input is available:

- open the Lina panel;
- start a hands-free session even if the manual panel is already open;
- use the configured microphone for wake-word detection and speech capture;
- clear stale transcript and error state;
- speak the acknowledgement;
- wait for speech output to finish before arming the microphone;
- switch to visible listening only after the microphone is live;
- play a short ready tone.

If voice input is unavailable, Lina shows a truthful in-app unavailable state instead of pretending the session can continue.

### Voice turn

Each turn follows this sequence:

1. show `preparing` while the microphone is arming;
2. play the ready tone once the microphone is live;
3. show live transcript preview;
4. use Deepgram `UtteranceEnd` as the primary end-of-turn signal;
5. allow a short settle window for a thinking pause;
6. use a longer safety stop only if no reliable boundary arrives;
7. transcribe the final utterance;
8. run the shared grounded assistant runtime;
9. speak Lina's response;
10. reopen the microphone for the next turn.

Wake-word sessions create a fresh Chat conversation and append spoken turns in order. The next wake word starts a new conversation.

## Ending The Session

V1 ends the hands-free session when the user says a stop phrase such as `stop`, `cancel`, `that's all`, or `thanks Lina`; no speech is detected; the user presses `Esc`; the Lina panel closes; Lina is turned off in Settings; or a microphone or speech-provider error breaks the turn.

Stop phrases receive a short closing line. Silence closes quietly.

## Speech Output Contract

Follow-up listening starts only after real speech completion:

- ElevenLabs resolves on the audio element's `ended` event;
- browser speech synthesis resolves on `SpeechSynthesisUtterance.onend`.

Timeout-only completion is insufficient because it can reopen the microphone too early and cause self-capture.

## Speech Input Contract

Deepgram is the primary path because it provides live transcript updates and utterance-end events. Use `nova-3` for preview and final transcription, keep `speech_final` as a boundary hint rather than an immediate stop, allow a 2.5–3.0 second endpointing window, treat silent turns as `no speech`, and keep the 45-second cap as a failsafe rather than the normal end rule.

Browser speech recognition remains available where supported as a degraded alternative to Deepgram.

## UI Expectations

The Lina panel makes the active phase obvious with messages such as:

- `Getting the microphone ready... wait for the beep`
- `Listening...`
- `Listening for follow-up...`
- `Thinking...`
- `Speaking...`
- `Hands-free voice session active`

The microphone and send buttons remain available as fallback controls. When Lina is turned off, the floating button, wake word, and shortcut become inactive immediately while Chat remains available.

## Follow-Up Rules

Wake-word sessions listen again after each spoken answer and remain open until silence or an explicit stop phrase. If Lina mishears a request, a correction such as `No, I said delete all of the tasks related to mirrors` is stored in account-backed assistant memory and shared with Chat.

## Verification

Future changes should verify wake-word acknowledgement before microphone opening, shared microphone configuration, the `preparing` state, ready-tone timing, unclipped first words, pause tolerance, uninterrupted requests, Deepgram endpointing, microphone reopening, silence and stop-phrase endings, Chat conversation ordering, and manual microphone fallback.

Also verify browser permission denial and unavailable-provider states remain truthful and leave Chat available.
