// Server Actions for the AI Assistant page.
//
// Flow (see src/app/CLAUDE.md "Assistant pattern"):
//   Client chat form  →  getRecommendationAction (useActionState wrapper, here)
//                     →  getCardRecommendation (core, here)
//                          →  matchCategory       (Gemini: free-text → our category)
//                          →  rankCardsForPurchase (DETERMINISTIC reward math)
//                          →  explainRecommendation (Gemini: phrase the result)
//
// CRITICAL: all reward arithmetic is done by rankCardsForPurchase (calculations/).
// Gemini only classifies the category and phrases the final numbers. This file goes
// through the data layer for every read (never the JSON file directly) and through
// src/lib/security/sanitize.ts for everything handed to Gemini (rule 3).

"use server";

import { getCards } from "@/lib/data/cards";
import { getRewardRules } from "@/lib/data/rewardRules";
import { getMilestones } from "@/lib/data/milestones";
import { getMilestoneTiers } from "@/lib/data/milestoneTiers";
import { getExclusions } from "@/lib/data/exclusions";
import { getCategories } from "@/lib/data/categories";
import {
  rankCardsForPurchase,
  type ExpectedCashback,
} from "@/lib/calculations/expectedCashback";
import { matchCategory, explainRecommendation } from "@/lib/ai/gemini";
import { sanitizeRankedForAI } from "@/lib/security/sanitize";

/**
 * Result of one recommendation request. `error` is non-null only when the request
 * couldn't be honoured (bad input) — callers should treat a non-null `error` as the
 * whole result being unusable rather than reading `results`. Kept as the exact core
 * shape the assistant exposes (`category` / `results` / `explanation`) plus an error
 * channel, per the page's documented contract.
 */
export interface CardRecommendation {
  category: string;
  results: ExpectedCashback[];
  explanation: string;
  error: string | null;
}

/**
 * Core recommendation routine. Validates input, then: classify the purchase into one
 * of OUR categories (Gemini, with an "Other" safe fallback), rank the user's active
 * cards DETERMINISTICALLY for that category + amount, and phrase the ranked result
 * conversationally (Gemini, with a template fallback). Every Gemini payload is built
 * through the sanitize boundary. Never throws on bad input — returns an `error` result.
 */
export async function getCardRecommendation(
  purchaseDescription: string,
  amount: number,
): Promise<CardRecommendation> {
  const description = (purchaseDescription ?? "").trim();
  if (!description) {
    return {
      category: "",
      results: [],
      explanation: "",
      error: "Describe what you want to buy.",
    };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return {
      category: "",
      results: [],
      explanation: "",
      error: "Enter an amount greater than zero.",
    };
  }

  // All rows come from the data layer. rankCardsForPurchase / calculateExpectedCashback
  // internally filter to active cards and active milestones, so we hand them the full
  // lists.
  const [cards, rewardRules, milestones, milestoneTiers, exclusions, categories] =
    await Promise.all([
      getCards(),
      getRewardRules(),
      getMilestones(),
      getMilestoneTiers(),
      getExclusions(),
      getCategories(),
    ]);

  // 1. Gemini: free-text → one of our exact category names (falls back to "Other").
  const category = await matchCategory(
    description,
    categories.map((c) => c.name),
  );

  // 2. Deterministic: the actual reward math (top 5 active cards, best first).
  const results = rankCardsForPurchase(
    cards,
    amount,
    category,
    rewardRules,
    milestones,
    milestoneTiers,
    exclusions,
  );

  // 3. Gemini: phrase the ALREADY-COMPUTED result. Only the sanitized shape (card
  //    names + computed rupee figures) crosses to Gemini — never raw rows or ids.
  const cardNameById = Object.fromEntries(cards.map((c) => [c.id, c.card_name]));
  const sanitized = sanitizeRankedForAI(results, cardNameById);
  const explanation = await explainRecommendation(
    description,
    category,
    sanitized,
  );

  return { category, results, explanation, error: null };
}

/**
 * State returned to the client chat form via React 19's `useActionState`. `cardNames`
 * is a non-sensitive id→name lookup so the client can label each ranked row (the
 * ranked rows themselves carry only computed figures + the internal card id). `ok`
 * gates whether this state should be appended to the on-screen conversation history.
 *
 * NOTE: a "use server" file may export ONLY async Server Actions, so the
 * `useActionState` INITIAL value is defined in the client component, not here — a
 * non-function export does not survive the RSC boundary (see src/app/CLAUDE.md
 * "Forms pattern" GOTCHA). This `type` export is erased at compile time, so it's fine.
 */
export type AssistantState = {
  ok: boolean;
  error: string | null;
  submitted: { description: string; amount: number } | null;
  category: string | null;
  results: ExpectedCashback[];
  cardNames: Record<string, string>;
  explanation: string | null;
};

/**
 * `useActionState`-shaped wrapper around {@link getCardRecommendation}: parses the
 * form fields, validates on the server (never trust the client), runs the
 * recommendation, and returns a state the client appends to its chat history. On any
 * validation problem it returns `ok: false` with a form-level `error` and leaves the
 * results empty.
 */
export async function getRecommendationAction(
  _prevState: AssistantState,
  formData: FormData,
): Promise<AssistantState> {
  const description = String(formData.get("description") ?? "").trim();
  const amountRaw = String(formData.get("amount") ?? "").trim();
  const amount = Number(amountRaw);

  const base: AssistantState = {
    ok: false,
    error: null,
    submitted: null,
    category: null,
    results: [],
    cardNames: {},
    explanation: null,
  };

  if (!description) {
    return { ...base, error: "Describe what you want to buy." };
  }
  if (!amountRaw || !Number.isFinite(amount) || amount <= 0) {
    return {
      ...base,
      error: "Enter an amount greater than zero (e.g. 500).",
    };
  }

  const rec = await getCardRecommendation(description, amount);
  if (rec.error) {
    return { ...base, error: rec.error, submitted: { description, amount } };
  }

  // Non-sensitive id→name map for labelling the ranked rows on the client.
  const cards = await getCards();
  const cardNames = Object.fromEntries(
    cards.map((c) => [c.id, c.card_name]),
  );

  return {
    ok: true,
    error: null,
    submitted: { description, amount },
    category: rec.category,
    results: rec.results,
    cardNames,
    explanation: rec.explanation,
  };
}
