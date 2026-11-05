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
