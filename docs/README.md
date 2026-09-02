# NEON RAID Engineering Documentation

- **Documentation status:** 2026-09-02
- **Audited implementation baseline:** `4ca95666fac598c2d4d3b0e76b20f25b3ceb0c75`
- **Production origin:** <https://neon-raid.cyberian13.workers.dev/>

The baseline SHA identifies the code and production implementation state documented by this handoff. The live `main` branch may advance after this documentation PR or later feature merges; check the actual GitHub `main` ref whenever an exact current SHA matters.

NEON RAID has reached its first online-playable milestone. On 2026-09-02, two-device Internet co-op was manually verified against the public production origin; this is a dated production smoke observation, not an automated end-to-end test.

## Reading order

1. [Engineering handoff](ENGINEERING_HANDOFF.md) — current system and repository ownership.
2. [Multiplayer contract](MULTIPLAYER_CONTRACT.md) — invariants future changes must preserve.
3. [Production runbook](PRODUCTION_RUNBOOK.md) — build, deploy, validation, and smoke operations.
4. [Roadmap](ROADMAP.md) — the ordered next engineering phases.
5. [Root README](../README.md) — user and developer quickstart.

## Source-of-truth precedence

When sources disagree about current behavior, use this order:

1. Current code on the actual GitHub `main` branch.
2. Automated tests for executable contracts.
3. Active documentation under `docs/`.
4. The root README quickstart.
5. Historical PR descriptions, old reports, and screenshots.

Archived or legacy material must never override current code, executable contracts, or active documentation. In particular, root [`TEST_REPORT.txt`](../TEST_REPORT.txt) is a historical v0.5 single-player smoke artifact. It remains for project history, but is not authoritative for the current multiplayer architecture or production behavior.
