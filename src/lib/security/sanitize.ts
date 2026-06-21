// sanitize.ts — the SINGLE security boundary for any payload that leaves this app
// for an external AI service (Gemini). See src/lib/CLAUDE.md rule 3 / SECURITY.md:
// nothing that builds an AI payload may hand a third party raw schema rows. Every
// outbound AI payload is constructed here so that encrypted card numbers, last-4,
// registered phone/email, OAuth tokens, and even internal record ids (UUIDs) can
// never leak off-box.
//
// This module is deliberately tiny and additive: each new AI feature adds ONE
// pure mapping function here that whitelists exactly the fields it is allowed to
// send. Whitelist, never blacklist — a new sensitive schema field must not start
// leaking just because someone forgot to strip it.

import type { ExpectedCashback } from "../calculations/expectedCashback";

/**
 * The ONLY card-derived fields permitted to reach Gemini for the recommendation
 * explanation: a human-readable card NAME plus the already-computed rupee figures.
 * Explicitly NOT included: the card's internal id/UUID, encrypted number, last-4,
 * phone, email, credit limit, or balances. `breakdown` (an internal formula string
 * like "5% cashback (₹25.00) + …") is also dropped — Gemini phrases from the
 * numbers, it doesn't need our internal accounting text.
 */
export interface AIRankedResult {
  cardName: string;
  directRewardValue: number;
  milestoneContributionValue: number;
  totalExpectedValue: number;
}

/**
 * Build the sanitized, name-resolved ranked list for the Gemini explanation prompt.
 * Takes the raw computed results (which carry only internal card ids) plus a
 * server-side id→name lookup, and emits the whitelisted {@link AIRankedResult}
 * shape — the single point at which an internal UUID is swapped for a safe name
 * and every other field is dropped. A card whose name can't be resolved falls back
 * to the neutral label "a card" rather than leaking its id.
 */
export function sanitizeRankedForAI(
  results: ExpectedCashback[],
  cardNameById: Record<string, string>,
): AIRankedResult[] {
  return results.map((r) => ({
    cardName: cardNameById[r.cardId] ?? "a card",
    directRewardValue: r.directRewardValue,
    milestoneContributionValue: r.milestoneContributionValue,
    totalExpectedValue: r.totalExpectedValue,
  }));
}
