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
- **Data-access layer started**: `src/lib/data/fileStore.ts` (sole file-path owner) + `src/lib/data/cards.ts` (getCards, getCardById, createCard, updateCard)
- **Test harness**: tsx added as devDependency; `npm test` runs `src/lib/data/cards.test.ts` — 11/11 assertions pass; test restores the seed file so it never mutates committed data

## Pending
- Phase 1: data-access modules for the other 12 tabs (rewardRules, transactions, payments, recurringTransactions, milestones, milestoneTiers, feesAndCharges, exclusions, monthlySnapshots, familyCapTracker, cardTermsHistory, categories)
- Real AES-256-GCM encryption for `card_number_encrypted` (currently the literal `PLACEHOLDER_NOT_ENCRYPTED`) — `src/lib/security/encryption.ts`, a later phase
- Calculation modules (reward/milestone/FY math) in `src/lib/calculations/`

## Next session should read
- /CLAUDE.md (root)
- /STATUS.md (this file)
