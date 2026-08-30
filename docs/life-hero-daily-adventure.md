# Life Hero Daily Adventure

KAN-270 adds a short, optional turn-based practice loop to the signed-in Life
Hero companion. It is a use of permanent progression, not another progression
source.

## Contract

- The encounter derives capability from the authoritative seven-stat snapshot,
  overall level, current momentum, and temporary conditions.
- The opponent, response pattern, and move damage are deterministic for the
  local date and snapshot capability.
- Strike, Guard, and Focus are plain buttons with `1`, `2`, and `3` keyboard
  shortcuts. The encounter exposes health progress bars, a live event log, and
  the active conditions.
- A same-day checkpoint is stored as an additive `lifeHeroAdventure` field on
  the existing account-owned `gamification/profile` record. A reload or
  dashboard collapse therefore resumes an in-progress encounter.
- Loading, unavailable checkpoint, save failure, completion, and safe defeat
  are visible states. A failed save does not advance the visible checkpoint.
- Reduced motion affects the existing avatar presentation; the encounter has
  no required animation and remains fully usable with reduced motion.

## Non-progression safety

The game never calls the Life Hero evidence or award RPC. It does not award XP,
levels, badges, trophies, or permanent stat changes. Inactivity leaves the
checkpoint untouched. Defeat leaves the checkpoint and the permanent snapshot
untouched and offers a retry of the same deterministic encounter.

The current domain has no authoritative pet, equipment-inventory, or Life Hero
trophy records, so those systems are not invented by this feature. The
existing avatar loadout contract remains visual-only.

This document describes the branch implementation. Hosted release and
authenticated live persistence remain Sol-owned acceptance boundaries.
