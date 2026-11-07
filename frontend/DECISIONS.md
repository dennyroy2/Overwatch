# Decisions log (frontend + perception)

Format: date, decision, the alternative rejected, why.

<!-- CONTRACT CHEAT SHEET goes here (step 3) -->

## Log

| Date | Decision | Rejected alternative | Why |
|---|---|---|---|
| 2026-11-06 | Ownership guard counts committed + staged + unstaged changes; untracked files only warn | Failing on any untracked file | Local untracked root files (roadmap, PRODUCT.md) would make the guard fail forever; untracked files can't reach a PR until added |
| 2026-11-06 | Guard has a `CHECK_OWNERSHIP_FILES` test hook | Temporarily editing `contracts/` to test the guard | Hard rule 1: never touch files outside our folders, even briefly |
