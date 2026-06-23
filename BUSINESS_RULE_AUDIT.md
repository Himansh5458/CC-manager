# Business Rule & Domain Model Audit

**Scope:** Does CC-Manager's data model and business logic correctly and completely
represent how real Indian credit cards, milestones, rewards, and payment caps
actually work — including cases there is no seed/test data for yet. This is a
*domain-model* audit, not a code-correctness audit. Nothing is fixed here; every
finding is documented, severity-rated, and illustrated with a concrete real-world
example.

**Severity key:**
- **Critical** — silently produces wrong rupee numbers that drive a money decision.
- **High** — missing a capability a common real card actually needs.
- **Medium** — real but narrower edge case.
- **Low** — theoretical / rare.

**Files read in full before starting:** `/CLAUDE.md`, `/DECISIONS.md`,
`/KNOWN_LIMITATIONS.md`, `/docs/data-layer-contract.md`, `/src/lib/types/schema.ts`,
plus the implementing code for every claim below (`expectedCashback.ts`,
`milestoneProgress.ts`, `milestoneCycles.ts`, `cardBalance.ts`, `fyDates.ts`,
`familyCapTracker.ts`, `cards/actions.ts`, `app/page.tsx` family-cap section,
`_lib/format.ts`, and the seed `data/database.json`).

---

## Section 1 — Milestone model completeness

### 1.1 Multi-cycle look-back ("spend Q1, unlock Q3") — *PARTIALLY supported*

| | |
|---|---|
| **Real-world scenario** | A card runs a quarterly milestone where Q1 spend unlocks a benefit credited two quarters later (skip a quarter). |
| **Our model's actual behavior** | `earning_window_offset` is a single number; `earningWindow()` in `milestoneProgress.ts:75-88` loops `stepsBack = -offset` times, so `offset: -2` *does* select "two cycles back". A uniform N-cycle look-back **is representable**. |
| **Gap severity** | **Low** |
| **Concrete example** | "Spend in Q1 → unlock in Q3" = `cycle_frequency: "quarterly"`, `earning_window_offset: -2`. Works. The genuine gap is only a *non-uniform* offset (e.g. "look back 1 cycle in H1 but 2 cycles in H2") — one milestone row carries exactly one offset, so a schedule that changes its own look-back distance over time cannot be expressed. No real Indian card does this; rated Low. |

### 1.2 Cycle length changing mid-track (quarterly → monthly mid-year) — *real gap*

| | |
|---|---|
| **Real-world scenario** | A bank converts a milestone track from quarterly to monthly partway through the year (e.g. effective Oct 2026), a documented kind of T&C change. |
| **Our model's actual behavior** | A `Milestone` has one `cycle_frequency` with **no effective-date dimension**. `calculateCurrentCycle` (`milestoneCycles.ts:110`) applies the *current* frequency to *all of time*. Changing the field re-derives every past and future cycle as if it had always been monthly; the stored `cycle_start_date`/`cycle_end_date` get overwritten on the next recompute, and `current_progress_amount` is re-summed over the wrong window. There is no `CardTermsHistory`-style versioning for milestone cadence. |
| **Gap severity** | **High** |
| **Concrete example** | Quarterly track Jul–Sep accrued ₹2,40,000 (tier-1 ₹2,00,000 achieved). On 1 Oct the bank switches it to monthly and the user edits `cycle_frequency` to `"monthly"`. Next recompute now treats the *current* window as 1 Oct–31 Oct only; the Jul–Sep ₹2,40,000 falls outside the recomputed monthly window, so progress collapses to whatever was spent in October. The achieved tier-1 silently un-achieves (or, if `achieved_date` was stamped, you get an achieved tier whose recomputed progress no longer supports it). The only workaround is to clone the track into two rows by hand and manually freeze the old one. |

### 1.3 `tier_type` is binary — "highest 2 of 3" / diminishing tiers unrepresentable

| | |
|---|---|
| **Real-world scenario** | A milestone where more than one but not all tiers pay out, or tiers with diminishing marginal reward. |
| **Our model's actual behavior** | `TierType = "cumulative" \| "highest_only"` (`schema.ts:8`). `recomputeMilestoneProgress` (`milestoneProgress.ts:152-156`) implements exactly those two: every crossed tier, or only the single highest crossed tier. There is **no "top K of N"** mode. Note also `MilestoneTier.is_cumulative_payout` exists in the schema (`schema.ts:128`) but is **never read by any calculation** — a dormant field that looks like it should control payout aggregation but does nothing. |
| **Gap severity** | **Medium** |
| **Concrete example** | Amex-style "spend ₹1.5L → 5,000 pts; ₹3L → +7,500 pts; ₹4.5L → +10,000 pts" where the increments are *additive but each milestone pays its own marginal bonus and a cap applies to the count of milestones honored in a year* (e.g. "max 2 milestone bonuses per year"). We can model additive payouts as `cumulative`, but we cannot cap it at "highest 2 of 3" — `cumulative` will mark all three achieved and `highest_only` will mark only one. The expected-cashback milestone-contribution sum (`expectedCashback.ts:151-164`) would then over- or under-count the pull toward those tiers. |

### 1.4 Dropping MCC/category exclusion from milestone eligibility — *meaningfully wrong, confirmed in code*

| | |
|---|---|
| **Real-world scenario** | Most premium Indian cards count only *curated* spend toward milestones — rent, wallet loads, fuel, government/tax, EMIs, utilities are commonly **excluded** from milestone-qualifying spend. |
| **Our model's actual behavior** | `recomputeMilestoneProgress` (`milestoneProgress.ts:120-126`) sums **every** transaction on the card within the window with **no category filter and no consultation of the `Exclusion` tab at all**. Crucially, even though `Exclusion.applies_to` has a `"milestones_only"` scope and `expectedCashback.ts` *does* honor exclusions, the milestone-*progress* engine ignores them entirely. So all spend is milestone-eligible regardless of any exclusion row. |
| **Gap severity** | **Critical** |
| **Concrete example** | **Axis Atlas** (a real seed card) excludes rent, government, wallet, gold, fuel, utilities and EMI from milestone-qualifying spend; its annual milestone is ₹3L / ₹7.5L / ₹15L. A user who pays ₹1,50,000 of rent on the card across the year sees our Milestones page count the full ₹1,50,000 toward the ₹3L tier — the bar shows **50% to the first milestone**. Reality: ₹0 of that rent qualifies, so they are nowhere near it. If they then stop spending believing tier-1 (worth 2,500 bonus miles ≈ ₹2,500+) is one more rent payment away, they will **miss the milestone entirely**. The error is the full excluded amount — here ₹1,50,000 of phantom progress — and it directly drives a "do I need to spend more?" decision. |

### 1.5 Welcome / joining bonus ("spend X in first Y days") — *works with friction*

| | |
|---|---|
| **Real-world scenario** | "Spend ₹50,000 within 90 days of card issuance → 10,000 bonus points." A one-time, issuance-anchored, fixed-window milestone. |
| **Our model's actual behavior** | Modelable as a `Milestone` with `cycle_frequency: "custom"`, `cycle_start_date = issuance_date`, `cycle_end_date = issuance + 90d`, one `MilestoneTier` (threshold ₹50,000, reward 10,000), `tier_type: "cumulative"`. `calculateCurrentCycle` echoes the stored custom window (`milestoneCycles.ts:115-120`) and `recomputeMilestoneProgress` sums in-window spend — so it computes correctly. |
| **Gap severity** | **Medium** |
| **Concrete example / friction actually hit while modeling one** | (a) The 90-day window must be **hand-computed** from `issuance_date` and typed into `cycle_end_date`; nothing derives "first Y days" from issuance, so a data-entry error silently mis-dates the window. (b) There is **no "one-time" flag** — once the 90 days pass, the milestone stays `active` forever, perpetually showing the same expired custom window (custom cycles never advance), so it lingers on the Milestones page until someone manually flips `active=false`. (c) `earning_window_offset` look-back is a no-op for custom cycles, which is fine here but means a welcome bonus can't reuse the offset machinery. Net: representable, but it is a manual workaround riding on the generic milestone shape rather than a first-class "welcome bonus" concept. |

---

## Section 2 — Reward rule model completeness

### 2.1 One category per rule — sub-category distinctions ("dining but not food delivery")

| | |
|---|---|
| **Real-world scenario** | "5x on dining at restaurants, but standard rate on food-delivery apps (Swiggy/Zomato)." A split *within* one of our categories. |
| **Our model's actual behavior** | `RewardRule.category` is a single string matched against the transaction's category (`expectedCashback.ts:120-122`), and our category list has one `"Dining"` bucket (no "Food Delivery"). There is no MCC, no sub-category, no merchant-level rule. A card therefore gets exactly one dining rate. |
| **Gap severity** | **High** |
| **Concrete example** | HDFC Diners Black: 10x on SmartBuy/select merchants, base elsewhere; or any card that gives accelerated dining only on physical restaurant swipes. A ₹2,000 Zomato order and a ₹2,000 restaurant dinner both classify as `"Dining"` and both receive the single stored dining rate. If we store the 5x restaurant rate, Zomato is overvalued; if we store base, restaurants are undervalued. The assistant's ranking is wrong for whichever side doesn't match the stored rate. |

### 2.2 No annual-spend-tier base rate ("spend >₹10L last year → 2% base")

| | |
|---|---|
| **Real-world scenario** | Premium cards whose **base** earn rate steps up with prior-year total spend, independent of any milestone (e.g. a card that pays 1% normally but 2% once lifetime/annual spend crosses a tier). |
| **Our model's actual behavior** | `RewardRule` has `multiplier_or_rate` + `rate_type` + an optional `monthly_cap`, but **no spend-tier / threshold-conditioned rate**. The rate is constant. There is nowhere to express "this base rate applies only above ₹10L cumulative annual spend." |
| **Gap severity** | **Medium** |
| **Concrete example** | Axis Magnus / Reserve-style: base reward rate improves after a high annual-spend threshold. To model the better rate we'd have to either overstate the base for low spenders or understate it for high spenders — there's no conditional. The assistant cannot reflect "you've crossed ₹10L this FY, so this card is now your best base earner." |

### 2.3 Rotating bank-selected category — *only modelable by row churn*

| | |
|---|---|
| **Real-world scenario** | A card offering 5x on a *different* category each quarter (bank rotates: Q1 dining, Q2 travel, Q3 groceries…). |
| **Our model's actual behavior** | `RewardRule.category` is fixed and has no effective-date. The only way to rotate is to **delete and re-create** (or add) a rule each quarter — there is no time-bounded rule and `deleteRewardRule` exists precisely as the blunt instrument. Doing so also destroys history: a past purchase can no longer be re-explained against the rate that was active when it occurred, because the old rule row is gone. |
| **Gap severity** | **Medium** |
| **Concrete example** | A 5x-rotating card: in Q2 you swap the rule's category from "Dining" to "Travel". `rankCardsForPurchase` (`expectedCashback.ts:195`) only ever sees the *current* rule set, so a Q1 dining purchase re-opened in Q2 is now scored at Travel's rate. There is no representation of "5x dining was true Jan–Mar, 5x travel Apr–Jun" within one stable rule. |

### 2.4 Single `redemption_value_per_unit` — tiered redemption can flip the ranking

| | |
|---|---|
| **Real-world scenario** | Points/miles worth different amounts depending on redemption channel (e.g. Atlas EDGE miles ≈ ₹1 as cash/voucher but ≈ ₹2 when transferred to an airline partner). |
| **Our model's actual behavior** | `RewardRule.redemption_value_per_unit` and `MilestoneTier.redemption_value_per_unit` are each a single static number (`schema.ts:62,127`). `expectedCashback.ts:135-136` multiplies the per-100 earn by exactly that one value. There is no notion of best-case vs cash-out value. |
| **Gap severity** | **High** |
| **Concrete example (ranking flips)** | A ₹1,00,000 flight booking, user who **always** transfers miles to an airline (real value ₹2/mile). Atlas: 5 miles/₹100 → 5,000 miles. Stored `redemption_value_per_unit = 1` (the conservative cash value), so the tool scores Atlas at **₹5,000**. A flat 6% cashback card scores **₹6,000**. The tool ranks the cashback card first. But this user's real Atlas value is 5,000 × ₹2 = **₹10,000** — Atlas is the genuinely correct choice and beats the cashback card by ₹4,000. The single redemption number makes the assistant recommend the worse card on a six-figure purchase. (Storing `2` instead would invert the error for a user who only ever cashes out.) |

---

## Section 3 — Family payment cap model completeness

### 3.1 Name-variant fragmentation silently splits one person into two "families"

| | |
|---|---|
| **Real-world scenario** | The same real person's name is entered slightly differently on two cards: "Rohit Singh" vs "Rohit  Singh" (double space) or "R. Singh". |
| **Our model's actual behavior** | `parent_family` is built as `` `${card_bank} ${card_holder}` `` with **no normalization** (`cards/actions.ts:207`) and the dashboard groups families by raw string equality (`app/page.tsx:191,207`: `new Set(... c.parent_family)` and `t.family_key === family`). Any whitespace/spelling/punctuation difference yields a different key, so the two cards become two families, each measured against a *full* ₹8L cap. |
| **Gap severity** | **High** |
| **Concrete example** | "HDFC Rohit Singh" pays ₹5,00,000 this FY; a second HDFC card entered as "HDFC Rohit  Singh" (double space) pays ₹4,00,000. Real combined = ₹9,00,000, which is **over** the ₹8,00,000 cap. The dashboard shows two green rows at ₹5L/₹8L (62%) and ₹4L/₹8L (50%) — the user believes they have ₹3L+ of headroom on each when they have actually breached the cap. The breach is invisible precisely because the grouping is string-exact. |

### 3.2 `parent_family = bank + holder` may be the wrong grain entirely (across-bank aggregation)

| | |
|---|---|
| **Real-world scenario** | One person (one PAN) holds an HDFC card and an Axis card. A regulatory/reporting-style spend ceiling on an individual aggregates **across all banks** for that person. |
| **Our model's actual behavior** | Because the key includes `card_bank`, the same person's HDFC and Axis cards are **two separate families** ("HDFC Rohit Singh" vs "Axis Rohit Singh" — exactly what the seed shows). Each gets its own ₹8L bucket. `format.ts:62` describes the cap as "a hard regulatory-style ceiling," which is a *per-person* concept, yet the grouping is per-person-**per-bank**. (Note: I looked for the stated rationale — the audit prompt references a `DECISIONS.md` entry "parent_family = bank + cardholder," but **no such entry exists in `/DECISIONS.md`**; the decision is encoded only in code/comments, undocumented.) |
| **Gap severity** | **Critical** (if the cap is genuinely a per-individual ceiling) |
| **Concrete example** | Rohit pays ₹6,00,000 on his HDFC card and ₹6,00,000 on his Axis card this FY. A PAN-level ₹8L ceiling is breached at ₹12,00,000 total. Our dashboard shows two comfortable rows — HDFC ₹6L/₹8L (75%, amber) and Axis ₹6L/₹8L (75%, amber) — and **never** aggregates them, so the ₹12L real exposure against an ₹8L individual ceiling is never surfaced. Whether this is wrong depends on the cap's true definition (per-bank-relationship vs per-individual); the model has hard-committed to per-bank without that being documented or configurable, so if the intent is per-individual the numbers are silently and seriously wrong. |

### 3.3 Add-on / supplementary cards cannot be represented

| | |
|---|---|
| **Real-world scenario** | A primary cardholder issues an add-on card to a family member. The add-on's spends/payments are the **primary's** liability and report against the **primary's** PAN. |
| **Our model's actual behavior** | `Card` has a free-text `card_holder` and a computed `parent_family`; there is **no field linking a card to a different primary cardholder**. An add-on card entered with the family member's name becomes its own family; entered with the primary's name loses the fact that it's an add-on. There is no "this card is an add-on under primary X" relationship at all. |
| **Gap severity** | **High** |
| **Concrete example** | Rohit's primary Axis card and an add-on Axis card in his wife Priya's name. Correct cap behavior: both roll up under Rohit's PAN. Our options are both wrong: (a) enter holder "Priya Singh" → family "Axis Priya Singh", a separate ₹8L bucket, so the add-on spend never counts against Rohit's cap; or (b) lie and enter "Rohit Singh" → the add-on aggregates but the app now misrepresents who holds the card (wrong for statements, contact info, the Card Document View). Either way the model can't be simultaneously correct about identity and about cap aggregation. |

### 3.4 ₹8L cap is hardcoded — confirmed, and brittle to a regulatory change

| | |
|---|---|
| **Real-world scenario** | The threshold figure changes (regulatory/reporting limit revised, or the user wants a different self-imposed buffer). |
| **Our model's actual behavior** | Confirmed: `const FAMILY_CAP = 800000;` is hardcoded in `src/app/page.tsx:59`, with the figure **also** baked into a caption and into `_lib/format.ts:62`'s comment, and the colour-band thresholds (70%/90%) live separately in `format.ts:66-77`. There *is* a per-row `cap_amount` on `FamilyCapTracker` (used as `record?.cap_amount ?? FAMILY_CAP` at `page.tsx:212`), so an override is possible — but only if a tracker row exists, and the **default for every family with no row is the hardcoded constant**. The seed `familyCapTracker` array is empty, so today every family uses the hardcode. |
| **Gap severity** | **Medium** |
| **Concrete example** | If the limit moved from ₹8,00,000 to ₹10,00,000, updating it requires editing a constant in a **page component** (not a config/data module), plus the human-readable "₹8L" text in at least two files, and there's no single source of truth a future Sheets backend could read. It's a one-line code change today but it lives in the wrong layer (a React page, against the project's own "no business constants in `src/app`" spirit) and is duplicated in prose. |

---

## Section 4 — Statement cycle & date logic completeness

### 4.1 `statement_date` is a single day-of-month with no change history

| | |
|---|---|
| **Real-world scenario** | A bank shifts a card's statement date (e.g. from the 5th to the 12th effective March 2027) — a routine billing-cycle change. |
| **Our model's actual behavior** | `Card.statement_date` is one `number` (`schema.ts:29`) with no effective-date. `mostRecentStatementDate` (`cardBalance.ts:76`) applies the *current* day-of-month to *all* history. The moment the user edits it, every past cycle boundary is recomputed under the new day. There is a `CardTermsHistory` tab, but it's an audit log of *detected term changes* — it does not feed cycle math, and `recomputeCardBalance` never consults it. |
| **Gap severity** | **High** |
| **Concrete example** | Statement date 5 → 12 effective March 2027. A February purchase dated 2027-02-28 belonged to the "cycle starting Feb 5". After the user changes `statement_date` to 12, `recomputeCardBalance` for any date computes cycle starts on the 12th retroactively, so that Feb 28 txn may be re-bucketed into a different cycle than the one it actually billed in. "This month's spend" and the predicted-bill baselines (which average *completed* cycles via the same boundary, `insights.ts`) silently shift for all historical cycles. |

### 4.2 Short-month statement date (e.g. day 31 in February) — *correctly handled, verified*

| | |
|---|---|
| **Real-world scenario** | A card with `statement_date = 31` in a February (or 30 in February). |
| **Our model's actual behavior** | Verified handled in the **balance/utilization** path (a separate code path from milestone anniversaries): `statementDateForMonth` (`cardBalance.ts:56-64`) computes the month's last day via `Date.UTC(year, month+1, 0)` and `Math.min(statementDay, lastDayOfMonth)`, clamping 31 → 28/29 in Feb. `mostRecentStatementDate` (`cardBalance.ts:76-91`) uses it for both the current-month candidate and the one-month step-back. `insights.ts` reuses `mostRecentStatementDate` rather than reimplementing, so the two cannot drift. |
| **Gap severity** | **Low (no real gap found)** |
| **Concrete example / evidence checked** | For `statement_date = 31`, today 2027-02-15: current-month candidate clamps to 2027-02-28, which is > today, so it steps back to January → 2027-01-31. Both are valid real dates; no `Invalid Date`, no off-by-one. The clamp direction (back to last valid day) matches `addMonths` in `milestoneCycles.ts`, so balance cycles and milestone cycles treat short months identically. This section's concern is genuinely covered. |

### 4.3 FY (April–March) vs a card opened in February — *no miscalculation found*

| | |
|---|---|
| **Real-world scenario** | A card opened in February has its first activity straddling the FY boundary (Feb–Mar in one FY, Apr onward in the next). |
| **Our model's actual behavior** | `getFinancialYear` (`fyDates.ts:44-51`) maps any date purely by calendar month (Jan–Mar → previous-April FY), independent of when the card was opened. The family-cap section filters payments by `p.date >= fyStart && p.date <= fyEnd` (`app/page.tsx:198-205`) using those bounds. Milestone "annual" cycles are independent of the FY — calendar-anchored annual = Jan 1–Dec 31, anniversary-anchored = issuance-stepped — so a card's membership year and the tax FY are deliberately different axes and don't interfere. |
| **Gap severity** | **Low (no real gap found)** |
| **Concrete example / evidence checked** | Card opened 2027-02-20. A ₹50,000 payment on 2027-03-10 → `getFinancialYear` = "2026-27" (correct, Jan–Mar belongs to prior April). A ₹50,000 payment on 2027-04-10 → "2027-28". The cap tracker counts them in the right FY with no straddle. The only thing to be *aware* of (not a bug): a milestone with `cycle_anchor: "calendar"` + `annual` uses the **calendar** year, not the FY — correct for "spend ₹X per calendar year" tracks but it must not be confused with an FY-based track; the schema can express both (anniversary anchor for membership-year), so there's no representational gap. |

---

## Section 5 — Expected-cashback formula real-world stress test

### 5.1 Ignoring `monthly_cap` recommends an already-exhausted card

| | |
|---|---|
| **Real-world scenario** | A bonus reward category with a monthly cap the user has already hit this cycle. |
| **Our model's actual behavior** | `calculateExpectedCashback` reads `monthly_cap` from the rule but **deliberately never applies it** — full headroom is always assumed (`expectedCashback.ts:27-29` comment; no cap logic in the direct-reward branch at lines 126-138). This is a documented limitation (`KNOWN_LIMITATIONS.md`), but it produces a confidently wrong ranking. |
| **Gap severity** | **Critical** |
| **Concrete example with numbers (3 typical premium cards)** | Cards: **SBI Cashback** (5% on online, capped ₹5,000 cashback/cycle ≈ ₹1,00,000 online spend), **Amex MRCC**-style flat (effective ~1.5% on online via points), **Axis Atlas** (2 EDGE miles/₹100 online ≈ ₹2 value/₹100 = 2%). The user has *already* spent ₹1,00,000 online on SBI Cashback this cycle — its cap is **exhausted**, so the marginal rate on the next online purchase is the ~0.25% base. Now a **₹10,000** online purchase: <br>• **Tool ranks:** SBI Cashback 5% = **₹500** (top), Atlas 2% = ₹200, Amex 1.5% = ₹150. Recommends SBI. <br>• **Reality:** SBI marginal ≈ 0.25% = **₹25**; Atlas ₹200; Amex ₹150. The genuinely correct card is **Atlas at ₹200**. <br>• **Rupee impact:** following the tool earns ₹25; the correct choice earns ₹200 — a **₹175 loss on a single ₹10,000 purchase**, and the recommendation overstated SBI's value by **20×** (₹500 claimed vs ₹25 real). Repeated across a month of online spend this compounds into thousands. |

### 5.2 Binary exclusions conflate "no rewards" with "no *bonus*, base still earns"

| | |
|---|---|
| **Real-world scenario** | "Rent earns only the 1x base rate, not the 5x bonus" — excluded from the *accelerated* rate but still earning the base rate (a *partial* exclusion). |
| **Our model's actual behavior** | `Exclusion.applies_to` is `"all_rewards" \| "milestones_only" \| "direct_rewards_only"`. In `expectedCashback.ts:100-111,116-117`, a matching `direct_rewards_only`/`all_rewards` exclusion sets `directExcluded = true`, which **zeroes the entire direct reward** (`directBreakdown = "no direct reward (category excluded)"`). There is no "drop to base rate" — exclusion means **all** direct earn vanishes, not just the bonus. The model conflates "excluded from rewards entirely" with "excluded from the bonus rate but still earns base." |
| **Gap severity** | **High** |
| **Concrete example** | A card pays 5x (5%) on most spend but rent earns the 1% base. Correct value of ₹50,000 rent = ₹500 (1%). To stop the tool over-crediting 5% = ₹2,500, the only available move is a `direct_rewards_only` exclusion on "Rent" — which zeroes it to **₹0**, now *under*-crediting by ₹500. We cannot say "rent = base 1%." Either the card looks ₹2,000 too good (no exclusion) or ₹500 too stingy (exclusion). For a heavy-rent user (rent is often the largest line), this materially distorts which card is "best for rent." |

---

## Section 6 — Categories & merchant-mapping realism

Our fixed list (`data/database.json`, 16 categories): **Dining, Groceries, Fuel,
Travel, Shopping Online, Shopping Offline, Utilities, Entertainment, Health,
Insurance, Education, Rent, EMI, Government, Cash Advance, Other.** Cross-checked
against common real Indian merchant types:

| Real merchant type | Maps cleanly? | Problem |
|---|---|---|
| **Quick-commerce / instant grocery (Blinkit, Zepto, Instamart)** | Ambiguous | "Groceries" *or* "Shopping Online"? Many cards now treat quick-commerce as a **separate** accelerated (or excluded) category distinct from supermarket groceries — we can't distinguish, and the reward rate hinges on it. |
| **OTT subscriptions (Netflix, Hotstar, Prime)** | Ambiguous | "Entertainment" *or* "Utilities" (recurring bill)? Some cards have a dedicated OTT/subscription bonus. |
| **Ride-hailing (Uber, Ola, Rapido)** | Ambiguous | Folds into "Travel", but "Travel" reward rules usually mean flights/hotels; ride-hailing is often its own (or a Shopping/Other) bucket for earn purposes. |
| **EMI marketplaces (Bajaj Finserv, no-cost EMI checkout)** | Ambiguous | "EMI" *or* the underlying purchase category ("Shopping Online")? Reward eligibility differs sharply (EMI conversions are frequently reward-excluded). |
| **P2P / wallet loads (PhonePe, GPay, Paytm wallet top-up)** | **No clean home** | Falls to "Other". Real cards almost always **exclude** wallet loads from rewards and milestones; "Other" hides that and our milestone engine would count it (see 1.4). |
| **Co-working spaces (WeWork, etc.)** | **No clean home** | "Other" or stretch to "Utilities"/"Rent". Genuinely unmapped. |
| **Education-EMI platforms (Eduvanz, GrayQuest, etc.)** | Ambiguous | "Education" *or* "EMI"? Two equally defensible categories with different reward treatment. |
| **Telecom / mobile-DTH recharge** | Ambiguous | "Utilities" by default, but several cards carve telecom out as its own accelerated or capped category. |
| **Gold / jewellery** | **No clean home** | "Shopping Offline" by default, but it's a classic **reward-and-milestone-excluded** category on real cards — burying it in Shopping makes it earn like ordinary shopping. |
| **Pharmacy / diagnostics (PharmEasy, 1mg, labs)** | Clean | "Health" fits. |
| **Fuel (any pump)** | Clean | "Fuel" fits (note: real fuel earn is usually surcharge-waiver-only + reward-excluded — a *reward-rule* nuance, not a category-mapping one). |
| **Government / tax payments** | Clean | "Government" fits (commonly reward/milestone-excluded — same caveat). |

**Severity: High.** At least 9 of the ~12 common merchant types above are either
unmapped (→ silently "Other") or genuinely ambiguous between two categories with
**different reward and milestone treatment**. Because category is the single key
that drives both `calculateExpectedCashback`'s rate lookup and (incorrectly, per
1.4) milestone progress, an ambiguous or defaulted category directly produces a
wrong reward number. The two most damaging are **quick-commerce** (huge and
growing share of spend, rate-sensitive) and **wallet/P2P loads** (should be
reward- and milestone-excluded but land in "Other" and get counted).

---

## Prioritized fix list

If asked to make this tool trustworthy for someone with a genuinely complex
portfolio (5+ cards, mixed reward types, at least one rotating-category or add-on
card), fix in this order:

1. **Milestone progress must honor category exclusions (1.4).** *Critical.* The
   milestone engine counts excluded spend (rent, wallet, fuel, government) toward
   milestones and ignores even the existing `milestones_only` exclusion rows. This
   silently overstates progress by lakhs and drives "should I spend more?"
   decisions. Highest payoff: the `Exclusion` data already exists; the gap is that
   `recomputeMilestoneProgress` never reads it.

2. **Cap-aware expected cashback — apply `monthly_cap` with month-to-date spend
   (5.1).** *Critical.* The assistant confidently recommends already-exhausted bonus
   cards, overstating value up to ~20× and steering real money to the wrong card on
   every capped category.

3. **Resolve the family-cap grain: per-individual vs per-bank, and normalize the
   key (3.1 + 3.2).** *Critical/High.* Decide and **document** whether the ₹8L
   ceiling aggregates across banks (per PAN) or per bank-relationship; today it's an
   undocumented per-bank choice. Then normalize `parent_family` (trim/collapse
   whitespace, canonicalize) so a typo can't split a person into two full-cap
   buckets and hide a breach.

4. **Tiered / channel-dependent redemption value (2.4).** *High.* A single
   `redemption_value_per_unit` flips the card ranking on large miles purchases for
   users who transfer to partners — exactly the "complex portfolio" user.

5. **Partial (bonus-only) exclusions (5.2).** *High.* Add a "drops to base rate"
   exclusion mode so rent/fuel/government earn base instead of all-or-nothing;
   currently the largest spend lines are mis-valued either way.

6. **Effective-dated card terms for `statement_date` and milestone cadence (4.1 +
   1.2).** *High.* Editing a statement date or cycle frequency retroactively
   rewrites all history. Needs versioned/effective-dated terms (the
   `CardTermsHistory` tab is the natural seam but isn't wired into cycle math).

7. **Sub-category / rotating reward rules (2.1 + 2.3).** *High/Medium.* One fixed
   category per rule can't express "dining-but-not-delivery" or quarter-rotating 5x
   without destroying history via row churn.

8. **Add-on / supplementary card relationship (3.3).** *High* for any portfolio that
   actually has one — there is no field to express it, forcing a choice between
   correct identity and correct cap aggregation.

9. **Category list expansion / disambiguation (Section 6).** *High.* Add
   quick-commerce, wallet/P2P-load (as a reward-excluded category), OTT/subscription,
   telecom, and ride-hailing; resolve the Education-vs-EMI and gold ambiguities.
   Pairs naturally with fix #1 (excluded categories) and #2 (caps).

10. **"Top K of N" / diminishing milestone tiers and the dormant
    `is_cumulative_payout` field (1.3).** *Medium.* Either wire the unused field into
    the engine or remove it; add a bounded-payout tier type if a real card needs it.

11. **First-class welcome-bonus and ₹8L-cap configuration (1.5 + 3.4).** *Medium.*
    Quality-of-life: derive the welcome window from issuance, auto-expire one-time
    milestones, and move the cap figure out of a page component into config/data.

**Sections with no real gap found (genuinely investigated):** 4.2 (short-month
statement dates are correctly clamped in the balance path, verified against the
code and a worked Feb-31 example) and 4.3 (April–March FY math is correct for a
February-opened card, with the calendar-year-vs-FY distinction being a deliberate,
representable design choice, not a bug).
