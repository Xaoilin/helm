# Voice provider security

`assistant-speech` is the single ElevenLabs transport for Chat/Voice and Life
Hero. It verifies a real signed-in user before checking the existing
`HOSTED_AI_ENABLED` flag. The current default is paused: HTTP 503
`hosted_ai_paused` is returned before Vault or provider work and browser speech
remains available. No second mode flag or alternate hosted provider is used.

When explicitly enabled, the request contains only text (at most 5,000
characters), a Secrets entry UUID and a public voice ID. The server passes the
verified user's JWT to `list_helm_secrets` and `reveal_helm_secret`, checks an
active API-key entry, and sends its value only to ElevenLabs. It returns MP3
audio with `no-store`, or static actionable errors. Provider bodies, headers,
Vault details and raw exceptions are never returned or logged. There is no
service-role speech client, new global secret store or generic secret endpoint.

## Connection setup

1. Use the existing signed-in Secrets page to save a dedicated ElevenLabs key
   as an API key. Do not use the previously published credential.
2. In Settings, select that entry under **ElevenLabs secret reference** and set
   the public voice ID. Selecting an entry does not enable hosted AI.
3. The reference is stored only on this device. The public voice ID retains its
   existing shared account setting. Switching accounts requires selecting an
   entry owned by the new account; every enabled request rechecks ownership.
4. Choose **Browser speech** to remove the device reference. If the hosted path
   is paused, unavailable or fails playback, the shared transport uses browser
   speech. Stop cancels pending fetch/playback and prevents a late fallback.

New device writes use `helm:device:deviceSettings:v2` and exclude raw provider
values. The original `helm:device:deviceSettings` and any legacy `helm:settings`
containing provider values remain unchanged and readable by the existing
Secrets migration. This preserves migration access without copying plaintext
into new browser records or silently deleting a user's source. Secret
management remains intentionally excluded from external agent access.

Deepgram and Monzo have no secure replacement transport in this change. Their
browser-key configuration and build-secret paths are removed, and their UI
states describe the unavailable connection honestly. Public Google OAuth IDs,
ElevenLabs voice IDs and Supabase publishable configuration remain supported.

## Previously published key

Removing a public bundle does not revoke a credential. Security acceptance also
requires an actual provider confirmation for the exact previously published
ElevenLabs key. The controller owns that action and the redacted target receipt.
It must bind the public asset and key fingerprint without retaining the value,
then use the exact-key disable action or the authenticated provider dashboard.
Never disable unrelated keys or change workspace-wide policy to force an action.

ElevenLabs documents [exact-key disable](https://elevenlabs.io/docs/api-reference/api-keys/disable)
and [workspace key management](https://elevenlabs.io/docs/overview/administration/workspaces/api-keys).
The self-disable path is conditional on actual key/workspace policy; documentation
alone is not proof of revocation. Record a confirmed disabled state and the
redacted provider result, or retain an explicit external acceptance blocker.
No replacement key or funding is needed for the paused browser-fallback mode.

## Validation and release

Focused handler tests use synthetic Auth, Vault and provider responses for
ownership, invalid/archived references, provider failures, audio-only responses
and pause-before-Vault behavior. Browser checks at 390/1440px cover reference
persistence and legacy preservation. Desktop fixtures cover playback,
cancellation and fallback through both Lina and Life Hero.
CI builds with synthetic ElevenLabs/Deepgram/Monzo sentinels and scans emitted
assets. Protected function delivery stamps the exact source SHA; live acceptance
checks identity denial and the paused synthesis response with its synthetic Auth
fixture removed afterward. Enabled provider behavior is mocked, not a claim of
paid live synthesis acceptance.

Deploy through the existing protected Pages/Supabase route. Keep the hosted AI
pause in place. A rollback must preserve the secure client boundary; never
redeploy an older bundle containing a published provider key.

The implementation follows the current [Supabase user authentication boundary](https://supabase.com/docs/guides/functions/auth)
and [ElevenLabs speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
