# Life Hero Animated Modular Concept

Status: KAN-257 milestone candidate awaiting Sol and user approval. This is an isolated animated-GLB and modular-clothing proof, not a production avatar system, dashboard feature, persistence layer, progression system, or minigame.

## Honest artifact boundary

The approval surface is `concepts/life-hero/index.html`. It loads the project-bound `public/concepts/life-hero/assets/life-hero-modular.glb` through a small Three.js viewer.

This milestone does prove:

- an actual binary glTF 2.0 model renders in the browser;
- a complete neutral body and one jacket are distinct mesh nodes;
- both mesh nodes bind to the same 24-joint skin;
- the jacket can be hidden or shown without regenerating or replacing the body;
- `Idle_02`, `Motivational_Cheer`, `Running`, and `Walking` remain embedded;
- the same animation mixer drives the body and jacket;
- explicit static and `prefers-reduced-motion` fallbacks remain usable.

It does not prove a production rig, final topology, final garment quality, generalized wardrobe compatibility, body masking, production frame rate, dashboard placement, persistence, progression, analytics, voice, or minigame behavior.

`public/concepts/life-hero/life-hero-concept.png` remains approved art direction and a static visual fallback only. It is one flattened raster image, not a 3D model. It contains no skeleton, meshes, source layers, equipment slots, animation clips, visibility masks, or compatibility metadata.

## Model milestone

The previous trial contained 3,787 vertices and 4,193 triangles. The revised body contains 29,410 vertices and 31,045 triangles after a bounded 30K remesh. Rendered review shows a materially clearer face, hair silhouette, fingers, hands, and neutral charcoal underlayer than the trial. This is an approval-quality improvement, not a claim of final production fidelity.

The final exported structure was inspected from the GLB JSON and binary buffers locally; Meshy viewer “parts” were not used as acceptance evidence.

| Node | Mesh | Skin | Geometry | Role |
| --- | ---: | ---: | --- | --- |
| `LifeHero_BaseBody` | 0 | 0 | 29,410 vertices; 31,045 triangles | Complete original character with neutral underlayer. |
| `LifeHero_Jacket` | 1 | 0 | 6,198 vertices; 8,256 triangles | Separate rust jacket shell; runtime-toggleable skinned clothing. |

Skin 0 contains 24 joints. Both mesh primitives contain `JOINTS_0` and `WEIGHTS_0`. Hiding `LifeHero_Jacket` leaves `LifeHero_BaseBody` intact.

### Jacket proof and limitation

The jacket is a genuinely separate mesh generated locally from the improved body surface. It retains blended skin weights from the same skeleton and is offset radially to reduce body intersection. It is not a Meshy viewer grouping and it is not baked into the body texture or geometry.

Idle and Motivational Cheer representative frames show the jacket following the body without severe clipping. The shell is intentionally simple: it has a closed front, basic hem, and coarse neckline and cuffs. It does not establish production garment topology, collision, cloth simulation, generalized sizing, or production wardrobe readiness.

## Embedded motion proof

The exported GLB preserves these exact clips in this exact order:

| Embedded clip | Channels / samplers | Concept control |
| --- | ---: | --- |
| `Idle_02` | 72 / 72 | Idle; also slowed for low momentum. |
| `Motivational_Cheer` | 72 / 72 | Motivate. |
| `Running` | 72 / 72 | Train. |
| `Walking` | 72 / 72 | Focus. |

The mapping is explicit because this proof retains exporter clip names. The production contract below uses stable semantic names and must adapt exporter-specific names at ingestion rather than exposing array positions to consumers.

## Fallback and access behavior

- Normal mode renders and animates the real GLB.
- The visible Static fallback control replaces the canvas with the separate SVG body, clothing, and gear stack.
- `prefers-reduced-motion: reduce` forces that static stack and disables the 3D-motion control.
- The SVG harness, cuff, pack, and sash remain independently toggleable architecture assets. They are clearly labelled as concept-only; only the jacket is a real GLB clothing mesh in this milestone.
- The flattened PNG remains separately visible as approved art direction and another static reference.
- Controls are keyboard-operable, visibly focused, and paired with live text status.

## Bounded generation and local assembly pipeline

All Meshy tasks were generated as Private. No credentials, cookies, tokens, or API keys are stored in the repository or this document.

### ImageGen reference

The approved portrait was edited with the built-in ImageGen workflow to preserve the original human identity, charcoal neutral underlayer, grounded A-pose, palette, and non-magical direction while sharpening facial structure and producing clearly separated five-finger hands. The selected project-bound reference is `docs/design/source-assets/life-hero/life-hero-reference.png`.

Effective edit brief: preserve the approved Life Hero identity, proportions, hair, charcoal fitted neutral underlayer, shoes, and A-pose; improve facial definition and anatomically clear five-finger hands for image-to-3D use; keep a plain background and full unobstructed body; add no jacket, weapon, logo, copied character language, anime imitation, aura, or magic.

### Meshy receipt

| Step | Setting | Actual cost |
| --- | --- | ---: |
| Improved geometry | Image to 3D; Meshy 7 Flagship; High Detail; Ultra; image enhancement; A-pose; Private | 25 credits |
| Texture | Image input; Meshy 7 Flagship; 2K; PBR maps; Private | 10 credits |
| Remesh | Triangle topology; fixed 30K target; result 31,045 triangles | 0 credits |
| Meshy rig | Not run: the visible `+$20` would have raised this continuation from 35 to 55, beyond the authorized 50-credit cap | 0 credits |

Balance moved from 1,785 to 1,750. Total additional Meshy spend was exactly 35 credits; 15 authorized credits remained unused.

### Local assembly

The improved remesh was bounds-aligned to the approved animated trial. `scripts/build-life-hero-glb.mjs` blends skin influence from the eight nearest rig-source vertices, preserves the 24-joint skin and four animation clips, builds a separate weighted jacket shell, and emits one modular GLB. The source normal map was omitted from the assembled proof after rendered review exposed seam artifacts under the transferred non-uniform fit; geometry normals and the PBR base colour remain.

Rebuild and inspect with:

```sh
node scripts/build-life-hero-glb.mjs \
  --body docs/design/source-assets/life-hero/life-hero-high-detail-remesh.glb \
  --rig docs/design/source-assets/life-hero/life-hero-rig-source.glb \
  --output public/concepts/life-hero/assets/life-hero-modular.glb
node scripts/inspect-life-hero-glb.mjs public/concepts/life-hero/assets/life-hero-modular.glb
```

The inspector fails if the body and jacket are not separate named skinned nodes, if they do not both use skin 0, if the skin is not 24 joints, or if the exact four clips drift.

## Exact asset receipt

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `docs/design/source-assets/life-hero/life-hero-reference.png` | 1,744,624 | `34391698d21e5d01829dc227113626d4d9c186dc24d2f2ff3111d61dbf887fa3` |
| `docs/design/source-assets/life-hero/life-hero-high-detail-remesh.glb` | 20,438,196 | `4370954e21a80b11038af68ab92feaed44943df51a84b9cf3c0559817fb084bb` |
| `docs/design/source-assets/life-hero/life-hero-rig-source.glb` | 6,012,448 | `605c753e083eaeee20fb92264301fb40f6d63e929b1752de16a504a61e0f1a75` |
| `public/concepts/life-hero/assets/life-hero-modular.glb` | 28,068,700 | `3f507f356a5aa59ad2cff06be2bcfb4d9cec5a43fbd25721127e2407d6e7542e` |
| `public/concepts/life-hero/life-hero-concept.png` | existing approved fallback | `c14763d2cd25a37eb4d433a26ad9ea25d5aeffeaaacc4fa82368fcce9e690b59` |

## Production avatar contract

The production target remains a rigged glTF 2.0/GLB humanoid consumed through one versioned contract. The dashboard and minigame must reuse this contract rather than defining separate avatar rules.

### Skeleton and animation

- One shared humanoid skeleton identity per contract major version.
- The neutral body and every skinned clothing mesh bind to that skeleton.
- Stable semantic clip names are `idle`, `celebrate`, `focus`, `train`, and `tired`.
- An ingestion manifest maps exporter names such as `Idle_02` and `Motivational_Cheer` to the semantic names; consumers never depend on exporter array indexes.
- A missing optional clip falls back to `idle`; a missing or incompatible skeleton rejects the asset rather than guessing.

### Clothing, gear, and slots

- Body, clothing, and gear remain separately addressable assets.
- Clothing that deforms with the body is skinned to the shared skeleton.
- Rigid gear attaches to named skeleton sockets.
- Named slots are exactly `head`, `torso`, `legs`, `feet`, `back`, `mainHand`, `offHand`, and `accessory` for the first contract version.
- One active asset is allowed per exclusive slot unless a later contract version explicitly declares a composable sub-slot.

### Body-region visibility masks

An outfit can declare regions hidden while it is equipped to prevent body or underlayer clipping. Initial region names are `scalp`, `upperTorso`, `lowerTorso`, `upperArms`, `lowerArms`, `upperLegs`, `lowerLegs`, and `feet`.

Masks affect visibility only. They do not change identity, progression, rewards, data persistence, or gameplay behavior. Unknown region names make the asset incompatible so the consumer does not silently expose clipped geometry.

### Compatibility and fallback rules

Each asset manifest declares:

- contract version;
- required skeleton identity;
- asset kind: body, skinned clothing, or socketed gear;
- occupied named slot;
- optional body-region visibility mask;
- optional compatible body variants;
- required socket name for rigid gear.

Consumers validate the complete loadout before exposure. An incompatible optional asset fails visibly in diagnostics and is omitted. The character falls back to the neutral body and neutral clothing, preserving `idle`. A body or skeleton incompatibility rejects the loadout as a whole. Dashboard and minigame must produce the same compatibility result for the same manifest.

KAN-257 owns this concept contract only. KAN-260 owns production rendering and may refine exporter details without changing these semantic guarantees.

## 3D-printing applicability boundary

The frugal 3D-making review classifies this animated, skinned GLB as a visual and rigging asset, not a print-ready model. A future print adaptation must first choose and bake a neutral pose, remove the armature and animations, convert the desired body or garment to a closed manifold, define real wall thickness and clearances, repair intersections, and verify scale and orientation. Meshy “printability” and an on-screen closed surface are not physical-fit or strength evidence. Print the smallest representative fit or wall-thickness coupon before any full figure. KAN-257 buys no hardware and makes no service-load claim.

## Originality, motivation, halal direction, and scope

- Original human face, silhouette, palette, and equipment language; no named character, franchise, logo, costume, or signature attack was copied.
- Calm invitations and concise encouragement; never pressure, shame, or scolding.
- No music requirement, gambling, chance reward, loot box, weapon, aura, supernatural effect, or default magic.
- No production 3D engine decision, dashboard placement, persistence, progression, rewards, providers, analytics, voice behavior, or minigame behavior.
- No merge, release, deployment, Jira completion, or KAN-258 work.

## Rendered evidence

### Desktop — 1440 by 900 viewport

![Life Hero desktop modular GLB proof](./evidence/life-hero-desktop-1440x900.png)

### Mobile — 390 by 844 viewport

![Life Hero mobile modular GLB proof](./evidence/life-hero-mobile-390x844.png)

### Idle jacket frame

![Life Hero Idle frame with separate jacket](./evidence/life-hero-idle-jacket-frame.png)

### Motivational Cheer jacket frame

![Life Hero Motivational Cheer frame with separate jacket](./evidence/life-hero-cheer-jacket-frame.png)

### Reduced motion — 390 by 844 viewport

![Life Hero reduced-motion layered fallback](./evidence/life-hero-reduced-motion-390x844.png)

| State | Rendered observation | SHA-256 |
| --- | --- | --- |
| Desktop 1440 by 900 | Actual GLB, rust jacket, controls, local structure, and flattened-image warning render without horizontal overflow. | `1cc477deeae5c73bf9a15ad6d467fc459a8ecf77da15d97849ca8a1c8b717b0e` |
| Mobile 390 by 844 | Actual GLB remains framed below the responsive heading; the page has no horizontal overflow and the controls remain reachable by document scroll. | `9dc00ba2a5835892eaf6c0c1bdf052cb0e8cb1124e6f3a06b50f8efe56345ded` |
| Idle jacket frame | Jacket follows the body in the sampled Idle frame without severe body breakthrough. | `2481f0b42d0ffd9eb9c1222c756fad9b7c87a0a40fd68443e3921fe9ad0491d1` |
| Motivational Cheer frame | Jacket follows the raised and crossing arm pose without severe clipping; coarse neckline and cuffs remain a documented proof limitation. | `fa73b48bc93ead5ec20ae0ab69be01fe25bbc56072b5702c60cedffd55411773` |
| Reduced motion 390 by 844 | 3D motion is disabled and the separately layered static SVG fallback is visible with written meaning retained. | `6426f121392862d02c8ede3b83f52f4ed7a017a990c0d503d2298c475d05b2d3` |

Focused Playwright coverage validates the GLB structure, runtime jacket toggle, exact motion mapping, mobile behavior, explicit static mode, reduced-motion fallback, and independent SVG equipment toggles. Rendered review at the exact desktop and mobile viewports found no new overlap, clipped controls, or horizontal overflow. The coarse jacket boundaries remain an explicit production-quality risk rather than a hidden acceptance claim.
