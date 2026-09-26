# Deprecated Features

On 2026-09-26 three features were disabled and scheduled for removal from the codebase:

- **Life Hero**: the character companion, the daily adventure, and the evidence sources that only feed it.
- **The Lina assistant**: the Chat surface, the floating Lina panel, the planner, hosted AI and Ollama checks, and the assistant audit trail.
- **Voice**: wake word, speech recognition, microphone access, and speech playback.

They are switched off, not deleted. The code, its unit tests, and the database objects remain so each feature can be deleted in one focused change, or re-enabled by flipping its switch.

## How they are disabled

`src/config/deprecatedFeatures.ts` holds three build-time switches, all `false`:

| Switch | Feature |
| --- | --- |
| `LIFE_HERO_ENABLED` | Life Hero |
| `ASSISTANT_ENABLED` | Lina assistant |
| `VOICE_ENABLED` | Voice |

The switches are product decisions, not user settings. A stored `lifeHeroEnabled`, `assistantEnabled`, or `wakeWordEnabled` setting cannot turn a disabled feature back on. `isSurfaceAvailable` withholds the `chat` surface while the assistant is disabled.

What the switches do:

| Where | Effect while disabled |
| --- | --- |
| `src/App.tsx` | Chat is not in the sidebar, mobile bar, or More sheet. `VoiceAssistant` (the floating Lina panel and voice runtime) is not rendered, so no wake word, microphone, speech, or planner call starts. |
| `src/store/ShellContext.tsx` | A stored `chat` session surface, a `navigate('chat')`, or an assistant navigation request for `chat` opens the Dashboard. |
| `src/store/pageCollections.ts`, `src/store/PageReadinessGate.tsx` | Activity no longer loads `assistantActivityLog` or the finance records its undo read, and does not wait for them. |
| `src/surfaces/ActivitySurface.tsx` | The Lina audit trail and undo section is hidden; private usage insight remains. |
| `src/surfaces/SettingsSurface.tsx` | Life Hero, Voice Assistant (Lina), and Local AI (Ollama) sections are hidden. No assistant runtime status check and no microphone permission request or device enumeration runs. |
| `src/surfaces/DebugSurface.tsx` | Wake Word, AI Assistant, and Audio Pipeline tabs are hidden; Debug opens on Network / APIs. |
| `src/components/dashboard/NightCompassDashboard.tsx` | The Life Hero companion (and its adventure, snapshot sync, and voice) is never mounted. |
| `src/surfaces/IntegrationsSurface.tsx` | The GitHub App card is hidden and its status load and OAuth callback handling do not run. |
| `src/surfaces/HealthSurface.tsx` | The Apple Health movement import is hidden. |
| `src/surfaces/KnowledgeSurface.tsx` | The Elif B manual evidence form is hidden. |

The assistant providers (`AssistantProvider`, `AssistantActivityProvider`, `ChatBridge`/`ChatProvider`, `AssistantUndoProvider`) stay mounted in `src/store/AppProviders.tsx` so `PageReadinessGate` and the provider-order checks keep working. They make no network calls: account collections load only when a page activates them, and no page activates `conversations`, `assistantCorrections`, or `assistantActivityLog` while the assistant is disabled.

Supabase Edge Functions, RPCs, tables, and migrations are unchanged. Nothing in the browser calls the deprecated ones.

Each deprecated source file starts with `/** @deprecated Disabled 2026-09-26; remove with the feature. See docs/deprecated-features.md */`.

## Life Hero

Status: disabled. Switch: `LIFE_HERO_ENABLED`.

Source files:

- `src/components/dashboard/LifeHeroCompanion.tsx`
- `src/components/dashboard/LifeHeroAdventure.tsx`
- `src/components/AppleHealthMovementImport.tsx` (only feeds Life Hero evidence)
- `src/components/knowledge/ElifBManualEvidence.tsx` (only feeds Life Hero evidence)
- `src/hooks/useLifeHeroVoice.ts` (also voice)
- `src/services/lifeHeroAdventure.ts`
- `src/services/lifeHeroPresentation.ts`
- `src/services/lifeHeroProgression.ts`
- `src/services/githubLifeHero.ts`
- `src/services/appleHealthMovement.ts`
- `src/services/elifBManualEvidence.ts`
- `src/types/lifeHeroProviderRoutes.ts`

Code inside shared files:

- `src/store/supabase.ts`: `fetchLifeHeroSnapshot`, `syncLifeHeroEvidence`, `acceptLifeHeroEvidence`, `recomputeLifeHeroProfile`, and the `mapLifeHero*` mappers.
- `src/types/domain.ts`: `LifeHero*` types and `Settings.lifeHeroEnabled`.
- `src/store/recordCodec.ts` and `src/store/contexts/SettingsContext.tsx`: the `lifeHeroEnabled` setting field and default.
- `src/store/contexts/SettingsContext.tsx`: the `int-github` default integration.
- `src/config.ts`: `GITHUB_LIFE_HERO_FUNCTION`.
- `src/surfaces/IntegrationsSurface.tsx`: the GitHub state, handlers, and card.
- `src/components/dashboard/NightCompassDashboard.tsx`, `src/surfaces/HealthSurface.tsx`, `src/surfaces/KnowledgeSurface.tsx`, `src/surfaces/SettingsSurface.tsx`: the guarded mount points.
- `src/surfaces/ActivitySurface.tsx`: usage copy that says analytics is separate from Life Hero progression.

CSS in `src/App.css`: the `Life Hero dashboard companion` section (`.life-hero-*`) and the `.apple-health-import*` rules, including their responsive overrides.

Assets and scripts: `public/concepts/life-hero/`, `docs/design/source-assets/life-hero/`, `docs/design/evidence/life-hero-*`, `scripts/build-life-hero-glb.mjs`, `scripts/inspect-life-hero-glb.mjs`, and the `three` dependency (used only by the companion).

Unit tests: `life-hero-adventure.test.ts`, `life-hero-adventure.test.tsx`, `life-hero-companion.test.tsx`, `life-hero-presentation.test.ts`, `life-hero-progression.test.ts`, `life-hero-provider-routes.test.ts`, `github-life-hero.test.ts`, `apple-health-movement.test.ts`, `apple-health-movement-import.test.tsx`, `elif-b-manual-evidence.test.tsx`, and the Life Hero cases in `settings.partition.test.tsx` and `night-compass.activity-help.test.tsx`.

Browser specs (skipped): `e2e/life-hero-dashboard.spec.ts`, `e2e/life-hero-concept.spec.ts`, `e2e/apple-health-movement.spec.ts`. `e2e/integrations.spec.ts` now proves the GitHub card is absent and makes no `github-life-hero` call; `e2e/smoke.spec.ts` proves Settings has no Life Hero toggle and the Dashboard no companion. Life Hero fakes and the `lifeHeroEnabled: false` scenario settings in `e2e/support/helm-fixture.ts`, `e2e/prayer-services.spec.ts`, and `e2e/milestone-celebration.spec.ts` remain until removal. `e2e/activity-viewer.spec.ts` still checks usage copy that mentions Life Hero.

Supabase (list only; unchanged):

- Edge Function `github-life-hero` (and its deploy step in `.github/workflows/deploy-supabase-assistant.yml`).
- Migrations `20260830070000_life_hero_progression.sql`, `20260830103000_life_hero_evidence_sync.sql`, `20260830120000_github_life_hero.sql`, and Life Hero parts of `20260830073000_product_usage_analytics.sql`.
- Tables `life_hero_profiles`, `life_hero_evidence`, `life_hero_awards`, `life_hero_rulesets`, `life_hero_evidence_rules`, `life_hero_stat_rules`, `life_hero_stat_profiles`, `life_hero_source_tier_rules`, `life_hero_momentum_rules`, `life_hero_legacy_snapshots`, `github_life_hero_connections`, `github_life_hero_oauth_states`.
- Public RPCs `get_life_hero_snapshot`, `sync_life_hero_evidence`, `accept_life_hero_evidence`, `recompute_life_hero_profile`, `accept_github_life_hero_evidence`, `save_github_life_hero_credential`, `get_github_life_hero_credential`, `set_github_life_hero_selection`, `mark_github_life_hero_sync`, `delete_github_life_hero_connection`, plus `helm_private` helpers.
- Database tests `supabase/tests/life_hero_progression.sql`, `life_hero_evidence_sync.sql`, `github_life_hero.sql`, and Life Hero checks in `scripts/test-helm-database.mjs` and `scripts/verify-helm-database.mjs`.

Docs: `docs/life-hero-dashboard.md`, `docs/life-hero-daily-adventure.md`, `docs/life-hero-progression.md`, `docs/life-hero-provider-routes.md`, `docs/design/life-hero-concept.md`, `docs/apple-health-movement-import.md`.

## Lina assistant

Status: disabled. Switch: `ASSISTANT_ENABLED`.

Source files:

- `src/assistant/` (every module, including `evals/`)
- `src/surfaces/ChatSurface.tsx`
- `src/store/contexts/ChatContext.tsx`
- `src/store/contexts/AssistantContext.tsx`
- `src/store/contexts/AssistantActivityContext.tsx`
- `src/store/contexts/AssistantUndoContext.tsx`
- `src/services/assistantAvailability.ts`
- `src/services/assistantBilling.ts`
- `src/services/assistantDebug.ts`
- `src/services/assistantModels.ts`
- `src/services/assistantNavigation.ts` (still imported by `ShellContext`, `TasksSurface`, and `ProjectsSurface`)
- `src/services/chatExport.ts`
- `src/services/hostedAssistantAccess.ts`
- `src/services/hostedAssistantApi.ts`
- `src/services/hostedAssistantBillingApi.ts`
- `src/services/ollamaApi.ts`
- `src/components/debug/AiDebug.tsx`
- `src/components/VoiceAssistant.tsx` (also voice)

Code inside shared files:

- `src/store/AppProviders.tsx`: `ChatBridge` and the assistant providers.
- `src/store/PageReadinessGate.tsx`: `useAssistantPageReady` and the `chat`/`activity` readiness branches.
- `src/store/pageCollections.ts`: `ASSISTANT_PAGE_COLLECTIONS` and the `chat` entry.
- `src/store/ShellContext.tsx`: assistant navigation requests.
- `src/App.tsx`: the `chat` registry entry.
- `src/surfaces/ActivitySurface.tsx`: `AssistantActivitySection`.
- `src/surfaces/SettingsSurface.tsx`: the Lina and Ollama sections, `OllamaModelSelector`, and runtime status.
- `src/surfaces/DebugSurface.tsx`: the AI Assistant tab.
- `src/types/domain.ts`: the `chat` surface, conversation, activity, undo, and correction types; `Settings.assistant*`, `hostedModel`, `ollama*`.
- `src/store/storeKeys.ts`: `conversations`, `assistantCorrections`, `assistantActivityLog`.
- `src/config.ts`: `DEFAULT_ASSISTANT_PROVIDER`, `HOSTED_ASSISTANT_FUNCTION`, `HOSTED_ASSISTANT_BILLING_FUNCTION`, hosted model label, `OLLAMA_ENDPOINT`.
- `src/config/constants.ts`: `CHAT` and assistant limits.

CSS in `src/App.css`: the `Chat` section (`.chat-*`) and its responsive rules, and the audit rules in the `Lina Activity` section (`.activity-audit`, `.activity-entry*`, `.activity-status`, `.activity-transcript`, `.activity-details`, `.activity-error`, `.activity-no-undo`, `.activity-notice`). `.activity-surface` and the usage rules stay.

Scripts: `scripts/run-assistant-benchmark.ts`, `scripts/compare-assistant-models.mjs`, `scripts/stamp-assistant-deployment.mjs`, `scripts/verify-hosted-assistant-access.ts`, `scripts/lib/assistantBenchmarkAuth.ts`, and the npm scripts `benchmark:assistant`, `llm-compare`, and the benchmark part of `release:check`.

Unit tests: `assistant.portfolio.test.ts`, `assistant-prayer-completion-rules.test.ts`, `chat-recovery.test.tsx`, `chat-send-context.test.tsx`, `hosted-assistant-auth.test.ts`, `hosted-assistant-client.test.ts`, `hosted-assistant-paused.test.ts`, and assistant cases in `page-loading.ui.test.tsx`, `editor-draft-recovery.test.tsx`, `composition.boundaries.test.ts`, `employment-tracker.test.ts`, `time-zone.portfolio.test.ts`, and `fixtures.ts`.

Browser specs: the Chat retry case in `e2e/interaction-recovery.spec.ts` and the Lina audit paging case in `e2e/page-loading.spec.ts` are skipped. `e2e/shell.spec.ts` replaces the paused-hosted-AI walkthrough with a proof that a stored `chat` surface opens the Dashboard, navigation, Settings, and Debug offer no assistant or voice entry point, and no assistant, speech, Life Hero, or Ollama request is made. `e2e/page-loading.spec.ts` proves Activity and a stored `chat` surface read no assistant collections. The `assistant-openai` fake in `e2e/support/helm-fixture.ts` remains until removal.

Supabase (list only; unchanged): Edge Functions `assistant-openai`, `assistant-openai-billing`, and `assistant-speech` (also voice); `supabase/functions/_shared/assistantAuth.ts` and `assistantMode.ts`; the deploy and benchmark workflows `.github/workflows/deploy-supabase-assistant.yml` and `post-deploy-assistant-benchmark.yml`; the account collections `conversations`, `assistantCorrections`, and `assistantActivityLog`.

Docs: `docs/assistant-command-architecture.md`, `docs/assistant-conversational-architecture.md`, and the Assistant and voice section of `docs/project-architecture.md`.

## Voice

Status: disabled. Switch: `VOICE_ENABLED`. The floating Lina panel needs both `ASSISTANT_ENABLED` and `VOICE_ENABLED`.

Source files:

- `src/components/VoiceAssistant.tsx`
- `src/components/VoiceConnectionSettings.tsx`
- `src/components/debug/WakeWordDebug.tsx`
- `src/hooks/useVoiceInput.ts`
- `src/hooks/useVoiceOutput.ts`
- `src/hooks/useWakeWord.ts`
- `src/hooks/useLifeHeroVoice.ts`
- `src/services/voiceAssistant.ts`
- `src/services/deepgramSTT.ts`
- `src/types/openwakeword.d.ts`

Code inside shared files: the wake word, voice connection, and microphone blocks and `MicTester` in `src/surfaces/SettingsSurface.tsx`; the Wake Word and Audio Pipeline tabs in `src/surfaces/DebugSurface.tsx`; `Settings.elevenLabs*`, `microphoneDeviceId`, `wakeWordEnabled`, `deepgramApiKey` in `src/types/domain.ts` and the settings codec; `ELEVENLABS_VOICE_ID` in `src/config.ts`; `TIMING.VOICE_*`, `DEEPGRAM_*`, and `VOICE_SESSION` in `src/config/constants.ts`.

CSS in `src/App.css`: the `Voice Assistant` section (`.va-*`, speech bubble, listening dots).

Assets and dependencies: `public/openwakeword/models/` and the `openwakeword-wasm-browser` dependency.

Unit tests: `use-voice-output.test.tsx`, `voice-assistant.test.ts`, `voice-vault-handler.test.ts`, `wake-word-models.test.ts`, and voice cases in `page-loading.ui.test.tsx`, `persistence.contract.test.ts`, `persistence.boundaries.test.ts`, and `settings.partition.test.tsx`.

Browser specs (skipped): `e2e/voice-playback.spec.ts`, `e2e/voice-connection.spec.ts`.

Supabase (list only; unchanged): Edge Function `assistant-speech`, and the device-only `elevenLabsSecretId` reference to a Vault secret.

Docs: `docs/voice-session-v1.md`, `docs/voice-provider-security.md`.

## Removal checklist

Delete one feature per change, and keep the required gates green.

1. Delete the source files listed for the feature and the guarded blocks in shared files. Remove the feature's switch from `src/config/deprecatedFeatures.ts`; delete the module when no switch remains.
2. For the assistant, remove `ChatBridge` and the assistant providers from `src/store/AppProviders.tsx`, drop `useAssistantPageReady`, the `chat` surface, and assistant navigation, then update `src/test/composition.boundaries.test.ts`, `scripts/verify-capability-composition.mjs` if it names them, and the provider-order text in `docs/project-architecture.md`.
3. Remove the feature's settings fields from `src/types/domain.ts` and the settings codec. Keep read-compatibility for stored records if the database still returns them.
4. Delete the CSS blocks, assets, scripts, npm scripts, and dependencies listed for the feature.
5. Delete the unit tests and the skipped browser specs, and remove feature cases from shared tests and `e2e/support/helm-fixture.ts`.
6. Plan database and Edge Function removal separately: stop deploying the functions, then drop RPCs and tables in a reviewed migration with a data retention decision. Remove the matching database tests.
7. Update `docs/feature-status.md`, `AGENTS.md`, `docs/project-architecture.md`, and delete the feature's docs. Remove the feature's section from this file.
