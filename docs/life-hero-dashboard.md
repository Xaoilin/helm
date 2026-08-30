# Life Hero dashboard companion

KAN-260 presents the permanent Life Hero snapshot without creating a second progression source. The signed-in browser reads `get_life_hero_snapshot` for the account-local date; loading, invalid, unavailable, and retry states remain local to the companion and never replace Prayer or another dashboard feature.

## Placement

- Desktop uses a bottom-right collapsible companion beside the existing voice control. The compact state remains available without taking dashboard grid space.
- Mobile starts as a dedicated collapsed Hero button above the bottom navigation. Opening it reveals a bounded, vertically scrollable companion panel; it is not described as an ARIA carousel because it does not rotate slides.
- The companion is last in dashboard DOM order, so the existing Prayer → Learn → Move → Tasks contract remains intact.

## Progression presentation

The companion shows overall level, total level progress, Faith, Vitality, Knowledge, Discipline, Finances, Craft, and Community. Each stat exposes its stored XP, level, and text-labelled condition. Conditions are motivational prompts only and cannot reduce XP or level.

“Best active momentum” is deliberately narrow: it is the greatest `momentumDays` value among recent awards whose stat is currently `steady`. It is not a profile-wide streak and is never inferred from app usage. If no qualifying award is present, the companion says the next step is ready and uses a neutral ×1.0 display.

Visual evolution is presentation-only:

| Overall level | Hero stage | Training base |
| ---: | --- | --- |
| 1–4 | New Recruit | Quiet training corner |
| 5–9 | Apprentice | Equipped training room |
| 10–19 | Pathfinder | Advanced training hall |
| 20+ | Steadfast Guide | Summit training hall |

These labels do not change database rules, XP, evidence, or equipment ownership.

## Modular avatar contract

`life-hero-avatar/v1` wraps the approved same-body GLBs in a consumer manifest with a pinned 24-joint skeleton identity, body variant, body regions, equipment slots, semantic clip mapping, and exact asset hashes. The verified training jacket is a separate skinned torso item. No other SVG concept layer is presented as real 3D equipment.

The runtime:

1. selects the maximum-quality asset on ordinary hardware;
2. uses the constrained GLB on devices reporting no more than 4 GB memory or 4 hardware threads;
3. validates the body and exact skeleton before rendering;
4. omits an incompatible optional jacket while keeping the neutral body;
5. maps missing optional movement clips to the verified idle clip;
6. tries the constrained GLB after a primary load or decode failure;
7. uses the approved static image if both 3D assets fail.

The static image is also used immediately for `prefers-reduced-motion`. The WebGL canvas is decorative; adjacent DOM text owns level, momentum, condition, loadout, and status meaning.

## Failure and rollback

Malformed rulesets, non-numeric progression values, duplicate or out-of-order stats, incomplete snapshots, and unavailable RPCs fail closed to a retryable local alert. The companion never invents level-zero data, never writes evidence, and never changes the primary dashboard.

Rollback is a UI removal: remove `LifeHeroCompanion` from `NightCompassDashboard` and its presentation files. KAN-258 progression tables, evidence, awards, and profiles remain untouched.
