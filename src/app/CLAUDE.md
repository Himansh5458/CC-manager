# Frontend Context (src/app)

## Scope
Everything under `src/app/` — pages, layouts, UI components, client-side state. This is the "frontend" half of the project.

## Rules
1. **Never call the data layer's storage internals directly.** Pages and components call functions exported from `src/lib/data/*` (e.g., `getCards()`, `saveTransaction()`). Never `fs.readFile` a JSON path or construct a Sheets API call from inside `src/app/`.
2. **Next.js 16 syntax is mandatory.** `params`/`searchParams` in any page/layout are Promises — always `await` them. See root `/CLAUDE.md` for details. Check `node_modules/next/dist/docs/01-app/` if unsure about a routing pattern.
3. **Design system compliance.** All colors, type, spacing, and component patterns must follow `/docs/design-system.md` (derived from the Startify Behance reference: dark charcoal #262E3B + yellow #F0D400 accent, Urbanist font, metric-card pattern, gauge/radar chart style). Do not introduce ad-hoc colors or fonts outside this system.
4. **No sensitive data in client-rendered output.** Encrypted card numbers, raw OAuth tokens, and the encryption key must never be passed as props to client components or appear in any client-side state. Decryption happens server-side only, per explicit user action.
5. **Every form/data-entry screen needs a review-before-save step** where extraction/computation could be wrong (statement parsing, benefit-dump extraction). This is a hard product requirement, not optional polish — see /DECISIONS.md.
6. **Pages reading live data must opt out of static prerendering.** Any page that reads the database or depends on the current date/time must declare `export const dynamic = "force-dynamic"` so it renders fresh on every request instead of being prerendered into a stale build-time snapshot. This is the default for this app — nearly every page is a live financial dashboard ("Due in X days", utilization, balances). Only omit it when a page renders genuinely static content, and document that exception inline.

## Current state
Phase 0: no pages built yet beyond Next.js scaffold defaults.

## Update this file
Whenever a new conventions or component pattern is established (e.g., "all forms use X library", "all tables use Y component"), add it here so future sessions follow the same pattern.
