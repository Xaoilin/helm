# Hosted Web CI Performance

GitHub Actions is the authoritative performance and validation boundary for Sabah One. GitHub Pages deployment and the Supabase Edge Functions it depends on use the same candidate identity as the checks that precede them.

## What To Measure

Keep these measures separate:

- policy, lint, typecheck, and unit-job duration;
- browser E2E duration and stability, including responsive overflow coverage;
- web-build and artifact publication duration;
- Pages and required function deployment duration;
- time from protected promotion to an observed matching website version;
- browser-observed user performance on representative surfaces.

Every receipt should identify the source revision, workflow run, artifact or deployment identity, environment, and observation window. A single green run is not a performance trend and a short job is not proof of a fast user experience.

## Review Rules

- Compare like-for-like workflow and browser scenarios.
- Report medians or percentiles over a stated window and retain failed or cancelled runs in the analysis.
- Keep CI feedback fast enough for pull-request iteration, but do not remove browser or account-bound checks to improve a number.
- Investigate regressions at the slowest job or user-facing boundary first; change one contributor at a time when evidence permits.
- Revisit thresholds when the workflow, browser fixtures, Supabase dependencies, or Pages deployment shape changes.

## Acceptance Boundary

Performance evidence supports the specific workflow, browser surface, or deployment path measured. It does not establish a universal device benchmark, guarantee browser notification delivery after a page closes, or replace direct hosted verification.
