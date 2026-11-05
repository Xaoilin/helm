# Sabah One prayer win records

Candidate version: 0.2.244. This ports Lina One PR25's win-record rules with
Sabah as the local player and Lina as partner; Lina One is unchanged.

The record begins on 1 November 2026. Day counts finished days in the displayed
month. Week and Month count whole completed periods since the start. Ties and
unscored periods stay separate. An incomplete comparison hides the entire
record, and old requests cannot publish into a new account or view.

All screenshots use synthetic account data. The daily examples show Sabah's
current 100% progress separately from a 1–4 historical record and one tie.
The December fixture proves completed weekly and monthly records. The existing
card is the concrete visual reference; the inherited prayer timeline is kept.

Local validation: nine focused unit cases; agent policy, typecheck and changed
ESLint; all 13 competition browser cases on the final runtime (17.8 seconds).
The independent visual/source review and source/render hashes are in review.json.
Hosted CI remains the authority for the complete repository gate.

Validation reused the byte-identical installed dependency lock entries from
Lina One through a local ignored node_modules link. Node 26's experimental Web
Storage was disabled for local tests, reusing the already verified jsdom fix.

Visual scope: the browser shell already uses fixed dark tokens and
`color-scheme: dark` in `src/index.css` (unchanged from master). The stored
`light` preference has no light CSS variant in this existing dashboard.
`record-light-*` filenames therefore identify the stored-preference fixture,
not a light appearance. All renders demonstrate the actual fixed-dark product;
this change does not implement or claim a second theme.

Hosted CI exposed an existing Finance MCP test that regenerated its synthetic
second-based token for each retry and the final assertion. The fixture now
captures one token for the exact retry pair. A local harness advancing the clock
by a second on every read failed before the repair and passed afterward; all
14 Finance MCP cases passed. Only the test fixture changed, not Finance runtime.

A second CI run reported three profile writes in an unchanged Settings test.
That sequence did not reproduce in twelve whole-file repetitions or six
controlled service-delay schedules. The schedules did prove that the displayed
time zone can arrive before all service settings are ready. The fixture now
holds the preferences reply, observes that partial state, and explicitly waits
for readiness before the intended post-load edit. Its exact one-write payload
assertion remains intact and now prints the complete call list on failure.
No Settings runtime behaviour was changed; the original three-write cause is
not claimed as reproduced or as a proven runtime defect.
