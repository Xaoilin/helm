# Native consent and approval visual review

Independent agent review: **PASS**. This is not owner acceptance or a production-release receipt.

Reviewed the actual Firefox desktop1440 and mobile390 consent states (unselected, selected, focused actions), actual25percent enlarged mobile text, and Settings approvals before/after revocation. The dark navy/cyan consent styling matches the actual Sabah One Settings reference. Permission boundaries and the primary action retain a clear hierarchy. Normal and enlarged action labels have deliberate padding and separation.

VA-003 and VA-004 are covered in `review.json` with source/render SHA-256 values and rendered panel bounds. In the final mobile Settings capture the complete Employment card and revoked status are above persistent navigation. Its permission notice and client row are separated by14px; the card ends at y568 before navigation starts at y772. Neighbouring content scrolling behind persistent chrome is intentional and does not obscure the target panel.

Render provenance: the four-test Firefox wrapper run `test-results/playwright/1793916862746-61626` supplied current Settings and consent renders. The fully visible normal mobile action render is reused from `test-results/playwright/1793916693174-61011`; visual source files were unchanged between these runs. The enlarged mobile render is byte-identical between those runs. Superseded captures are retained in `capture-1/` and `capture-2/` as evidence of capture-position gaps, not owner rejection or product-source defects.

The reviewer changed only this report directory; no product source, deployment or memory was changed.
