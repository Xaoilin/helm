# Visible 15-minute prompt rule

Version 0.2.249 clarifies that prompt prayer earns 12 challenge points only when
prayed within 15 minutes of the adhan. The completion dialog, always-visible
challenge footer and full timeline accessible label state the rule. The compact
Prompt ·12 timeline badge and original Prompt history selector remain unchanged.
Timing remains self-reported; backend rules, weights and logging-time behavior
are unchanged.

Firefox-only synthetic checks covered the existing seven timing scenarios. Extra
320 px captures cover normal rendering and actual 125% text stress: computed font
sizes are snapshotted before scaling, and inline sizes are restored between views
so inheritance does not compound. No new app setting was added. Intermediate
history images document an agent finding: the longer selector label was cramped,
so the original compact Prompt label was restored. These are reference images,
not final candidate renders or an owner rejection.

Source and screenshot hashes are bound by the independent visual review receipt.
No real account data was read. Temporary QA fixture files were removed.
