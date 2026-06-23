# Security

Living security checklist for CC-Manager. This is **not** a generic template — it
reflects the **actual current state of the app (Phase 6+)**, including controls that
are real and controls that are still placeholders. Update it every phase: tick the
checklist as items are addressed, and add new sections as new attack surface appears.

> **Single-user, local-dev context.** The app is currently a single-user tool running
> locally (and eventually on Vercel for that one user). That bounds the impact of
> several items below, but does **not** make them acceptable for production — each is
> tracked here so it is fixed on purpose, not rediscovered.

---

## 1. Card number "encryption" is CURRENTLY A PLACEHOLDER — real plaintext is on disk now

**Status: ⚠️ KNOWN GAP. This is a real, current risk — not just a future consideration.**

`Card.card_number_encrypted` does **NOT** hold an encrypted value today. The field name
is aspirational. What actually happens:

- The real AES-256-GCM `encrypt()` / `decrypt()` module — `src/lib/security/encryption.ts`
  (mandated by `src/lib/CLAUDE.md` rule 4: encryption logic lives in exactly one module,
  the only file allowed to touch the raw key) — **does not exist yet.**
- Every write site stores the **raw digits as-is**. The two write sites that must be
  swapped to `encrypt(...)` when the real module lands (each is documented as a
  `TODO(encryption)` one-line swap):
  - **`src/app/cards/actions.ts:263`** — `createCardAction`:
    `card_number_encrypted: cardNumberDigits!,  // RAW placeholder — NOT encrypted yet`
  - **`src/app/cards/actions.ts:325`** — `updateCardAction` (the "number changed" branch):
    `updates.card_number_encrypted = cardNumberDigits;  // RAW placeholder — NOT encrypted yet`
  - The surrounding `TODO(encryption)` comments (`cards/actions.ts:257-259` and `:323-324`)
    and the file header (`cards/actions.ts:12-17`) document the exact one-line swap.

**This is not only about seed placeholders.** The two seed cards hold the literal string
`"PLACEHOLDER_NOT_ENCRYPTED"`, which is harmless. But **any card added through the live
form is persisted with its real 16-digit number in plaintext** in `data/database.json`.
At time of writing, the third card (added via the form this build) stores the literal
plaintext `"6767676767676767"` in `card_number_encrypted`. So real, sensitive card
numbers are sitting unencrypted on disk **right now**, not hypothetically in the future.

**Mitigating factors (do not treat as a fix):** the full number never crosses to a
Client Component — only `card_number_last4` is ever sent to the UI (frontend rule 4) —
and no `decrypt()` call site exists yet because nothing reveals the full number.

**What a real-encryption implementation must touch (full list):**
1. Create `src/lib/security/encryption.ts` (AES-256-GCM `encrypt`/`decrypt`; the only file
   that reads the key — `src/lib/CLAUDE.md` rule 4).
2. `cards/actions.ts:263` — wrap `cardNumberDigits!` in `encrypt(...)`.
3. `cards/actions.ts:325` — same wrap in the update "number changed" branch.
4. Add a server-side-only `decrypt(...)` call site **if/when** the full number is ever
   revealed (per explicit user action; must never cross to a Client Component —
   frontend rule 4).
5. **Migrate existing stored data** — re-encrypt the plaintext `"6767676767676767"` and
   the `"PLACEHOLDER_NOT_ENCRYPTED"` seed values in `data/database.json`.
6. Add an `ENCRYPTION_KEY` (or KDF) env var alongside `GEMINI_API_KEY` in `.env.local`,
   read **lazily** (as `gemini.ts` reads its key) so `next build` never needs it. Document
   it in §3 below.
7. Update test fixtures that use the placeholder string (`cards.test.ts`, `cardBalance.test.ts`,
   `dueDate.test.ts`, `insights.test.ts`) if the field's shape changes.

---

## 2. AI / export sanitization boundary — the single chokepoint

**Status: ✅ control exists and is on the live path · ⚠️ has NO test yet (real gap).**

`src/lib/security/sanitize.ts` is the **single** place any payload bound for an external
AI service (Gemini) — or any future export feature — is constructed (`src/lib/CLAUDE.md`
rule 3). Its job is to guarantee that no raw schema row, internal id, or sensitive field
ever leaves the box.

**What `sanitizeRankedForAI(results, cardNameById)` does:**
- Takes the raw `ExpectedCashback[]` (which carry only internal card **UUIDs**) plus a
  server-side id→name lookup.
- Emits the **whitelisted** `AIRankedResult` shape: exactly **four** fields —
  `cardName` + the three already-computed rupee figures (`directRewardValue`,
  `milestoneContributionValue`, `totalExpectedValue`).
- **Whitelist, never blacklist.** Everything else is dropped by omission: the internal
  card id/UUID, `card_number_encrypted`, `card_number_last4`, registered phone/email,
  credit limit, balances, and even the internal `breakdown` formula string. A card whose
  name can't be resolved falls back to the neutral label `"a card"` rather than leaking
  its id.

It is genuinely on the path: `assistant/actions.ts:106` calls `sanitizeRankedForAI(...)`
and only the sanitized shape reaches `explainRecommendation` (`gemini.ts`). `matchCategory`
receives only the category-name list. The LLM does **zero** arithmetic
(`rankCardsForPurchase` is deterministic) — Gemini only classifies free text and phrases
already-computed numbers.

**The gap:** `sanitize.ts` has **no `.test.ts`**. This is the security boundary, and it is
untested. If any new field is ever added to `AIRankedResult` or the mapper, it could start
leaking silently with nothing to catch it.

**Rule for future work:** this module is the **single chokepoint**. Any new field added to
data sent to Gemini (or any new AI/export feature) MUST be added here as an explicit
whitelist entry — never bypass it, never blacklist. A test asserting the output keys are
exactly `{cardName, directRewardValue, milestoneContributionValue, totalExpectedValue}`
(and that UUID / encrypted number / last4 / phone / email / balance / breakdown are absent)
should be added — see TESTING.md.

---

## 3. Environment secrets — `GEMINI_API_KEY`

**Status: ✅ verified clean.**

- The only secret today is `GEMINI_API_KEY`, stored in `.env.local`.
- It is read **lazily** at call time inside `getClient()` (`src/lib/ai/gemini.ts:38-46`),
  which throws a clear error only when actually used — so `next build` never needs the key.
- The error message points the user here: *"GEMINI_API_KEY is not set. Add it to .env.local
  (see SECURITY.md) before using the AI assistant."* (`gemini.ts:42`).
- The key is never logged. `gemini.ts` error handlers log the error object, not the key.

**`.env.local` is gitignored and was never committed — verified, not asserted:**
- `.gitignore` ignores `.env*` (lines 33-34).
- `git log --all --oneline -- .env.local` → **empty** (no history).
- `git log --all --oneline -- '.env*'` → **empty** (no `.env`-family file was ever committed
  under any name).

When card-number encryption lands (§1), add `ENCRYPTION_KEY` here with the same lazy-read
discipline, and document it in this section.

---

## 4. Codespace CSRF / `allowedOrigins` configuration

**Status: ✅ intentional, dev-only.**

`next.config.ts` sets `experimental.serverActions.allowedOrigins`. This exists to work
around a **header mismatch specific to the GitHub Codespaces proxy** that otherwise breaks
every Server Action with E80 *"Invalid Server Actions request."*

**Why it's needed (the real mechanism):** In Codespaces the browser reaches the app through
a forwarded host (`https://<codespace>-3000.app.github.dev`), but the request arriving at
the Next.js server has **mismatched** host headers:
- `x-forwarded-host`: the rewritten `…-3000.app.github.dev`
- `origin`: `http://localhost:3000` (the proxy does **not** rewrite this)

Next's Server Actions CSRF check compares the *origin* host against the *forwarded* host and,
on mismatch, consults `allowedOrigins` via `isCsrfOriginAllowed(originHost, …)` — i.e. it
matches the allowlist against the **ORIGIN header's host** (`localhost:3000`), **not** the
forwarded domain. So whitelisting `*.app.github.dev` alone never matches; the list must
contain the literal origin host the browser actually sends (`localhost:3000`). The current
list is `[`*.${forwardingDomain}`, "localhost:3000", "127.0.0.1:3000"]`.

**Why it's safe in production:** the list is keyed off the
`GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN` env var. That var is **absent on Vercel**, so the
list is `[]` and Next's default strict same-origin CSRF behaviour is fully restored — the
dev workaround widens nothing in production. (This was discovered through real browser
testing — see TESTING.md.)

---

## 5. Per-phase security checklist

Tick items as they are addressed. Add new rows as new surface appears. An unchecked box is
a tracked, deliberate gap — not an oversight.

### Data at rest
- [ ] **Real AES-256-GCM encryption** of card numbers (`src/lib/security/encryption.ts`) — see §1
- [ ] Swap the two `TODO(encryption)` write sites (`cards/actions.ts:263`, `:325`) to `encrypt(...)`
- [ ] Add a server-side-only `decrypt(...)` site if the full number is ever revealed
- [ ] Migrate existing plaintext/placeholder values in `data/database.json`
- [ ] `ENCRYPTION_KEY` env var added, read lazily, documented in §3
- [x] Full card number never crosses to a Client Component (only `card_number_last4` does)

### Outbound data / AI boundary
- [x] Single sanitize chokepoint exists (`sanitize.ts`) and is on the live Gemini path
- [x] Whitelist (not blacklist) — only `cardName` + 3 rupee figures leave the box
- [x] LLM does zero arithmetic; degrades to deterministic fallback on any failure
- [ ] **Test for `sanitize.ts`** asserting the exact output key set — see §2 (current gap)

### Secrets
- [x] `GEMINI_API_KEY` read lazily; never logged
- [x] `.env.local` gitignored and verified never committed
- [ ] `ENCRYPTION_KEY` handled with the same discipline (pending §1)

### Request / CSRF
- [x] Server Actions CSRF allowlist scoped to Codespaces env var only; empty (strict) in prod
- [x] Server-side validation re-checks every form field; dropdowns validated against the live DB
- [x] Server-forced fields (`source`, `confidence_flag`, `parent_family`, `last4`) never trusted from client

### Data layer
- [x] All DB access goes through the single data-access layer (`src/lib/data/`); only `fileStore.ts` touches the file path
- [ ] JSON file writes have no locking (last-writer-wins) — bounded by single-user use; revisit before multi-user

### Future phases (Google Sheets / Vercel)
- [ ] OAuth token storage & refresh handled securely when the Sheets backend lands
- [ ] Re-audit `allowedOrigins` and CSRF posture for the Vercel deployment
