# CC-Manager — Root Project Context

## What this is
A personal credit card management tool: tracks spends, payments, milestones, reward optimization, and statement parsing. Built for single-user (Himansh) use, deployed eventually to Vercel, currently in local-dev phase only.

## Stack
- Next.js 16.2.9 (App Router, TypeScript, Tailwind, Turbopack)
- React 19.2
- Dev-phase database: local JSON file (`/data/database.json`), structured to mirror the eventual Google Sheets schema exactly
- Production-phase database: Google Sheets via OAuth (not yet implemented)
- AI: Gemini API for card recommendation assistant and benefit-dump extraction (not yet implemented)

## CRITICAL: Next.js 16 syntax requirements
This project uses Next.js 16.2.9, which has breaking changes from earlier versions commonly seen in training data. Always follow these patterns:
- `params` and `searchParams` in page/layout components are Promises: `const { slug } = await params`, never destructure directly
- Caching is opt-in via `"use cache"` directive; do NOT assume implicit caching behavior from older Next.js versions
- Turbopack is the default bundler
- When in doubt, check `node_modules/next/dist/docs/` or the official Next.js 16 docs before writing routing/caching code

## Architecture principle: Data Access Layer
NO feature code (pages, components, API routes) ever reads/writes the JSON file or (later) Google Sheets directly. Everything goes through a single data-access module — see `/frontend/CLAUDE.md` and `/backend/CLAUDE.md` and `data-layer-contract.md` for exact function signatures. This is what makes the future JSON-to-Sheets swap mechanical rather than a rewrite.

## Sub-level docs
- `/frontend/CLAUDE.md` — component conventions, references `design-system.md`
- `/backend/CLAUDE.md` — API route conventions, references `data-layer-contract.md`
- `/SECURITY.md` — living security checklist, updated every phase
- `/TESTING.md` — test scenarios, grows as bugs are found
- `/DECISIONS.md` — dated log of every judgment call made, with reasoning
- `/KNOWN_LIMITATIONS.md` — deliberate simplifications, documented so they aren't "fixed" by accident later
- `/STATUS.md` — current phase, what's done, what's pending

## Current phase
Phase 0: Foundation scaffold. Next.js app created. Governance docs being established.

## Working agreement
This project is built phase-by-phase with Claude (chat) directing and Claude Code executing. Every phase ends with: tests passing, this file updated, SECURITY.md checklist ticked for relevant items, a clean commit, and a handoff note before the session ends.
