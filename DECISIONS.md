# Decision Log

## 2026-06-20 — Project structure
Standard Next.js layout chosen over custom frontend/backend folders. CLAUDE.md docs live at src/app/CLAUDE.md and src/lib/CLAUDE.md respectively, rather than restructuring into non-standard folders. Reasoning: fighting Next.js conventions costs more than it gains; all framework docs/examples assume standard structure.

## 2026-06-20 — Next.js version
Using Next.js 16.2.9 as scaffolded. This version has breaking changes from common training-data patterns (params/searchParams are now Promises, opt-in caching via "use cache"). All future routing/caching code must follow v16 syntax — verified against node_modules/next/dist/docs/ and official docs, not assumed from memory.

## 2026-06-20 — Database approach (dev phase)
Local JSON file mirrors the planned 13-tab Google Sheets schema exactly, accessed only through a single data-access layer (src/lib/data/). This makes the eventual swap to real Google Sheets API calls mechanical — same function signatures, different internals — rather than a rewrite touching every feature.
