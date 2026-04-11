# Voice Session V1

## Goal

Make Lina feel conversational after the wake word without jumping straight to a risky always-on duplex audio design.

V1 is intentionally turn-based and hands-free:

1. The user says `Hey Lina`.
2. Lina speaks a short acknowledgement.
3. Lina listens for one spoken turn.
4. Lina processes the request through the shared assistant runtime.
5. Lina speaks the answer out loud.
6. Lina reopens the mic for a follow-up turn.
7. The session ends on silence, a stop phrase, or a manual close.

This keeps the wake-word path voice-first while avoiding the common failure mode where Lina hears her own speech and re-triggers herself.

## Scope

V1 covers:

- spoken acknowledgement after wake word
- explicit mic-ready cue before the user should start talking
- hands-free turn-taking with no record-button click required
- live transcript preview while listening
- automatic mic reopening after Lina replies
- explicit spoken stop phrases
- session end on silence
- wake-word sessions mirrored into Chat history as separate conversation threads
- a full Settings toggle that turns Lina off completely without removing Chat

V1 does not attempt:

- full duplex conversation
- interruption while Lina is still speaking
- background always-listening conversations without a wake word
- provider-specific streaming LLM audio

## State Model

The voice assistant keeps the existing UI states:

- `idle`
- `open`
- `preparing`
- `listening`
- `processing`
- `speaking`

On top of those UI states, V1 adds two lightweight session concepts:

- `manual`
  Used when the user opens Lina normally or taps the mic button.
- `handsfree`
  Used only after the wake word starts a voice session.

Listening turns also track whether Lina is listening for the first request or a follow-up:

- `initial`
- `followup`

## Session Flow

### Wake word start

When the wake word fires and voice input is available:

- open the Lina bubble
- if the bubble is already open in manual mode, still start the hands-free session instead of ignoring the wake word
- use the same configured microphone device for wake-word detection and speech-to-text capture
- clear stale transcript and error state
- switch into `handsfree`
- speak the wake acknowledgement
- after speech output really ends, wait a very short guard delay and start arming the microphone
- only switch into visible listening once the mic is actually live
- play a short ready tone so the user knows Lina is ready for speech

If voice input is not available, Lina opens with a truthful degraded-state error instead of pretending the session can continue.

### Voice turn

Each turn follows the same sequence:

1. show a short `preparing` phase while the mic is arming
2. play the ready tone once the mic is really live
3. show live transcript preview while the user speaks
4. treat Deepgram `UtteranceEnd` as the primary end-of-turn signal
5. wait a short local settle window so a brief thinking pause does not end the turn too early
6. fall back to the existing max-duration stop if no reliable end-of-turn boundary arrives
7. transcribe the final utterance
8. run the shared assistant runtime
9. speak Lina's response
10. reopen the mic for the next turn

The chat and voice surfaces still share the same assistant runtime and mutation handlers.
Wake-word sessions should also create a fresh conversation in the Chat surface, append each spoken turn to that same thread, and start a brand-new thread the next time the wake word begins a new session.

## Ending The Session

V1 ends the hands-free session in any of these cases:

- the user says a stop phrase such as `stop`, `cancel`, `that's all`, or `thanks Lina`
- no speech is detected within the no-speech window
- the user presses `Esc`
- the user closes the Lina bubble manually
- the user turns Lina off in Settings
- a microphone or speech-provider error breaks the turn

When a stop phrase is heard, Lina speaks a short closing line first. When the session ends because of silence, Lina closes quietly so the experience does not feel noisy or repetitive.

## Speech Output Contract

Hands-free turn-taking only works if Lina knows when her own speech is truly finished.

Because of that, V1 relies on real speech completion:

- ElevenLabs resolves on the audio element's `ended` event
- browser speech fallback resolves on `SpeechSynthesisUtterance.onend`

Timeout-only completion is not good enough for wake-word conversations because it can reopen the mic too early and cause self-capture.
The follow-up mic-ready cue should only happen after that real speech completion, not on a guessed timeout.

## Speech Input Contract

Deepgram is the primary path for V1 because it exposes live transcript updates plus server-side utterance-end events.

Behavior:

- use Deepgram `nova-3` for both live preview and final transcription
- use Deepgram live events for preview and utterance-end detection
- keep `speech_final` as a transcript boundary hint, but do not end the turn immediately on that event alone
- use explicit live endpointing and utterance-end timing so short pauses feel more natural
- use the existing post-stop transcription path for final transcript accuracy
- treat silent turns as `no speech`, not as a generic error

Chrome speech fallback remains available, but it is still a degraded path compared with Deepgram.

## UI Expectations

The bubble should make the active voice phase obvious:

- `Getting the microphone ready... wait for the beep`
- `Listening...`
- `Listening for follow-up...`
- `Thinking...`
- `Speaking...`
- `Hands-free voice session active`

The mic and send buttons still exist as fallback controls, but the wake-word path should no longer require manual recording clicks.

When Lina is turned off in Settings, the floating button, wake word, and `Ctrl+Shift+L` shortcut should all be inactive immediately. The Chat surface should remain available.

## Follow-Up Rules

V1 keeps the follow-up rule simple:

- if the user entered the session by voice through the wake word, Lina automatically listens again after each spoken answer
- the conversation stays alive until silence or an explicit stop phrase ends it

This gives the user a natural spoken back-and-forth without needing a separate clarification-only branch or a complicated conversation planner.

If Lina mishears a spoken request, the user can correct her with phrasing like:

- `No, I said delete all of the tasks related to mirrors`

The shared assistant runtime now stores that correction in local-first assistant memory and applies it to future matching voice and chat turns.

## Verification

For any future changes to this flow:

- verify the wake word triggers spoken acknowledgement before the mic opens
- verify the wake word still works while the manual Lina bubble is open
- verify the wake word and speech-to-text paths are using the same configured microphone
- verify Lina shows `preparing` before the mic becomes visibly live
- verify the ready tone only plays once the mic is actually live
- verify the first spoken words are not clipped after the ready tone
- verify a brief 1-2 second thinking pause does not end the turn
- verify Deepgram auto-stops after utterance end plus the local settle window
- verify Lina reopens the mic after speaking
- verify silence ends the session cleanly
- verify stop phrases end the session cleanly
- verify each wake-word session appears in Chat as its own conversation with the spoken turns recorded in order
- verify the manual mic button still works outside hands-free mode

Changes to this flow should update this document, `docs/feature-status.md`, and any tests that cover voice session behavior.
