# Project Status

## Current Phase
Phase 1: Schema, seed data, and data-access layer — IN PROGRESS

## Done
- Next.js 16.2.9 scaffolded (TypeScript, Tailwind, App Router, Turbopack)
- Root CLAUDE.md written
- src/app/CLAUDE.md and src/lib/CLAUDE.md written
- SECURITY.md, TESTING.md, DECISIONS.md, KNOWN_LIMITATIONS.md created (empty, to be filled in Phase 1+)
- docs/design-system.md filled in; docs/data-layer-contract.md filled in (schema location + function signatures)
- data/ folder created for local JSON database
- **13-tab schema implemented** in `src/lib/types/schema.ts`
- **Seed data** written to `data/database.json` (2 cards — HDFC Millennia + Axis Atlas — plus reward rules, 10 transactions, payments, recurring txns, milestones/tiers, fees, exclusions; snapshots/familyCap/termsHistory intentionally empty)
- **Data-access layer — ALL 13 tabs complete**: `src/lib/data/fileStore.ts` (sole file-path owner) plus per-tab modules for cards, rewardRules, transactions, payments, recurringTransactions, milestones, milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker, cardTermsHistory, and categories. All follow the same pattern (fileStore-only access, `randomUUID` for new ids, immutable id on update) except the two structurally-different tabs: `familyCapTracker` (composite key `family_key`+`financial_year`, `upsert` instead of create/update) and `categories` (identity is `name`, idempotent `addCategory`). **This finishes the core data-layer portion of Phase 1.**
- **Calculations**: first `calculations/` module — `milestoneCycles.ts` (`calculateCurrentCycle`) with full unit test (calendar/anniversary anchors, leap-year edges, custom pass-through).
- **Test harness**: tsx added as devDependency; `npm test` auto-discovers every `*.test.ts` under `src/lib/` and runs each in its own subprocess. **14 suites, all passing**; each test snapshots/restores the seed file so committed data is never mutated. `npx tsc --noEmit` is clean.

## Pending
- Real AES-256-GCM encryption for `card_number_encrypted` (currently the literal `PLACEHOLDER_NOT_ENCRYPTED`) — `src/lib/security/encryption.ts`, a later phase
- Calculation modules (reward/milestone/FY math) in `src/lib/calculations/`

## Next session should read
- /CLAUDE.md (root)
- /STATUS.md (this file)
