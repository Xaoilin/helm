# Prayer timing and weighted challenge

Candidate version: 0.2.245. Synthetic account data only.

The completion dialog offers prompt (12), within-window (8), and outside-window
(2) choices. Saved timing survives reload and can be corrected without another
XP reward. The challenge shows weighted points separately from completion,
settles a current period after both participants finish its final day, and keeps
confirmed values and DOM geometry during refresh.

Independent visual review covers the three choices, compact saved status labels,
weighted card and held refresh at desktop/320 px. `review.json` binds eight visual
sources and ten renders. Stored dark/light preference scenarios both use Sabah's
existing fixed-dark shell; these are not evidence of a separate light appearance.

Validation before frozen CI: typecheck, policy, lint, web build and the seven new
browser scenarios passed. The first broad run passed 141/148 browser cases; a
shared Vite dependency cache caused Projects dynamic-import failures, and an old
smoke assertion expected the prior status label. With this worktree's Vite cache
isolated and the exact new accessible label asserted, all seven failed cases
passed. Five unit failures were the expected new timing field and newly added
contract registry entries; their 182-case targeted rerun passed. The protected
pipeline is the complete final validation authority.
