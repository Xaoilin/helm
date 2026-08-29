# Life Hero concept proof

KAN-257 owns this approval artifact only. It is a responsive, local browser proof of an original motivational human hero. It does not add production dashboard placement, persistence, progression, providers, analytics, voice, minigame behavior, release, or deployment.

The PNG at `public/concepts/life-hero/life-hero-concept.png` remains approved art direction and a static fallback. It is a flattened concept image, not a 3D model: it has no mesh, skeleton, clothing slots, or animation clips.

## Maximum-quality primary asset

Desktop and ordinary-capability devices load `public/concepts/life-hero/assets/life-hero-modular.glb`. It is the retained private Meshy native export assembled without changing source geometry, skin, inverse binds, or animation values:

| Property | Value |
| --- | --- |
| Format | glTF 2.0 binary (GLB) |
| Primary body | `LifeHero_BaseBody`, 332,478 vertices / 597,811 triangles |
| Clothing proof | `LifeHero_Jacket`, 105,602 vertices / 200,503 triangles |
| Skin | one shared 24-joint skin, skin 0 |
| Clips | `Idle_02`, `Motivational_Cheer`, `Running`, `Walking` |
| Native merged source SHA-256 | `9b850b4c61287c240d34bdb70da496255c68cd91cdf82f3152767677c664cd91` |
| Canonical output SHA-256 | recorded by the inspector and final evidence receipt |

The source contained two pixel-identical 8192×8192 PNG images: one used as base color and one incorrectly used as emissive. The builder retains one image at full resolution, removes the duplicate bytes, deletes emissive/specular extensions, sets `alphaMode` to `OPAQUE`, and uses natural opaque PBR. The exact deduplication receipt is embedded in `asset.extras.textureDeduplication`.

The jacket is a separate skinned concept shell derived from the exact native body. Each jacket vertex records `_SOURCE_VERTEX`; its `JOINTS_0` and `WEIGHTS_0` are copied from that native body vertex and it shares skin 0. A small deterministic outward offset prevents z-fighting. Hiding the node leaves the complete neutral body unchanged. This is a modularity and motion proof, not final wardrobe tailoring or a claim of production clothing readiness.

## Constrained-device fallback

`public/concepts/life-hero/assets/life-hero-modular-fallback.glb` retains the earlier 31K-triangle rig as a capability fallback. The viewer selects it when `navigator.deviceMemory <= 4` or `navigator.hardwareConcurrency <= 4`; otherwise the maximum-quality asset is primary. The fallback remains separately named, skinned, animated, and inspectable. This is a device-capability decision, not a dashboard LOD system; production LOD ownership remains with KAN-260.

## Viewer behavior

`concepts/life-hero/index.html` and `concepts/life-hero/viewer.js` provide:

- jacket on/off without replacing the body;
- face front, face three-quarter, left hand, right hand, and full-body inspection framing;
- Idle, Motivate (`Motivational_Cheer`), Focus (`Walking`), Train (`Running`), and Low momentum (`Idle_02`) controls;
- separate SVG source-layer controls for the concept-only body, clothing, and gear architecture proof;
- explicit static fallback and automatic `prefers-reduced-motion` fallback;
- keyboard-operable controls, visible focus, live status text, and mobile layout without horizontal overflow.

## Production avatar contract

The future target is one rigged glTF 2.0/GLB humanoid contract reused by dashboard and minigame. KAN-257 documents the contract; later tickets own production rendering and integration.

### Skeleton and clips

- One stable shared humanoid skeleton per contract major version.
- Body and deforming clothing bind to that skeleton; rigid gear attaches to named sockets.
- Stable semantic clips are `idle`, `celebrate`, `focus`, `train`, and `tired`.
- An ingestion manifest maps exporter names such as `Idle_02` and `Motivational_Cheer` to those semantic names. Consumers never depend on animation array positions.
- Missing optional clips fall back to `idle`. A missing or incompatible skeleton rejects the asset rather than guessing.

### Slots, masks, and compatibility

Named slots are `head`, `torso`, `legs`, `feet`, `back`, `mainHand`, `offHand`, and `accessory`. One active asset is allowed per exclusive slot.

Outfit manifests may declare body-region visibility masks for `scalp`, `upperTorso`, `lowerTorso`, `upperArms`, `lowerArms`, `upperLegs`, `lowerLegs`, and `feet`. Masks control visibility only and prevent clipping; unknown regions make the asset incompatible.

Every asset declares contract version, required skeleton identity, asset kind, occupied slot, optional mask, compatible body variants, and required socket for rigid gear. Consumers validate the complete loadout. An incompatible optional item fails visibly and is omitted while the character falls back to neutral body and clothing; a body or skeleton incompatibility rejects the whole loadout. Dashboard and minigame must produce the same compatibility result for the same manifest.

## Rebuild and inspect

The private Meshy source is intentionally not committed because the deduplicated canonical output is below the GitHub large-file threshold and is sufficient for this concept proof.

```sh
node scripts/build-life-hero-glb.mjs \
  --source /private/path/Meshy_AI_Athletic_Male_Figure_biped_Meshy_AI_Meshy_Merged_Animations.glb \
  --output public/concepts/life-hero/assets/life-hero-modular.glb
node scripts/inspect-life-hero-glb.mjs public/concepts/life-hero/assets/life-hero-modular.glb
```

The inspector verifies glTF 2.0, exact maximum-quality geometry counts, one 24-joint skin, all four clips, separate body/jacket nodes, copied jacket weights, immutable native accessor hashes, one 8192×8192 image, opaque non-emissive PBR, and the deduplication receipt.

## Originality and halal direction

The direction remains an original human hero: motivational, grounded, and non-scolding. It contains no copied anime character, music, gambling, loot boxes, chance rewards, weapons, default magic, or supernatural effects.

## Validation evidence

The exact validation order is install → build → focused browser/GLB tests → full repository test. Visual evidence is captured at 1440×900 and 390×844, with jacket on/off, Idle/Cheer, face and hand inspection, and reduced motion. These are branch-only approval artifacts; final acceptance remains with Sol and My Liege.
