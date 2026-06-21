// gemini.ts — the ONLY module that talks to the Gemini API.
//
// Design principle (non-negotiable): Gemini NEVER does arithmetic. Our deterministic
// calculations/ functions (calculateExpectedCashback / rankCardsForPurchase) do
// 100% of the reward math. Gemini has exactly two narrow jobs here:
//   1. matchCategory        — map free-text purchase wording to one of OUR existing
//                             category names (pure classification, no numbers).
//   2. explainRecommendation — phrase an ALREADY-COMPUTED ranked result in friendly
//                             prose, using the exact numbers we hand it verbatim.
//
// Both calls are best-effort: every failure mode (missing key at call time, network,
// rate limit, malformed reply) degrades to a SAFE deterministic fallback rather than
// throwing into the UI — matchCategory falls back to "Other" (the schema's catch-all),
// explainRecommendation falls back to a template string built from the numbers we
// already have. The feature stays usable even with Gemini completely unavailable.
//
// SECURITY: explainRecommendation only ever receives the sanitized AIRankedResult
// shape (src/lib/security/sanitize.ts) — card NAMES + computed rupee figures, never
// raw rows, internal ids, or any sensitive card field. See src/lib/CLAUDE.md rule 3.

import { GoogleGenAI } from "@google/genai";
import type { AIRankedResult } from "../security/sanitize";

// Free-tier Flash model. The user chose "gemini-2.5-flash" — a current, stable,
// widely-available free-tier Flash model (deliberately NOT the deprecated-2026-06-01
// "gemini-2.0-flash"). Kept as a single constant so swapping to a newer Flash tier
// (e.g. "gemini-3-flash") later is a one-line change. Verified SDK call shape against
// @google/genai v2.9.0 (ai.models.generateContent → response.text). See /DECISIONS.md.
const GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Read the API key once, at first use, and fail LOUDLY if it's absent — a clear
 * "set GEMINI_API_KEY" error here beats a confusing 400 from deep inside an SDK
 * call later. The client is created lazily (not at module load) so that importing
 * this module — e.g. during `next build`'s static analysis — never requires the key
 * to be present; only an actual matchCategory/explainRecommendation call does.
 */
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (see SECURITY.md) before using the AI assistant.",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** Strip whitespace/quotes/trailing punctuation a model sometimes wraps a one-word answer in. */
function cleanModelLabel(text: string): string {
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.。]+$/, "")
    .trim();
}

/**
 * Map a free-text purchase description to the SINGLE best-matching category from
 * `availableCategories`. Returns one of those exact category strings.
 *
 * The model is constrained hard: pick exactly one from the supplied list, reply with
 * only that name. We then re-validate the reply against the list case-insensitively
 * and return the canonical casing — so even a slightly-off reply can't introduce a
 * category we don't recognise. ANY failure (no key, network, rate limit, empty/unknown
 * reply) returns "Other", the schema's deliberate catch-all, rather than guessing
 * wildly or throwing. Errors are logged server-side for diagnosis.
 */
export async function matchCategory(
  purchaseDescription: string,
  availableCategories: string[],
): Promise<string> {
  // "Other" is our safe default; make sure it's actually offered to the model too.
  const fallback =
    availableCategories.find((c) => c.toLowerCase() === "other") ?? "Other";

  const description = purchaseDescription.trim();
  if (!description || availableCategories.length === 0) return fallback;

  const prompt = [
    "You are a strict classifier for a credit-card spend tracker.",
    "Choose the SINGLE category that best matches the purchase below.",
    "You MUST pick exactly one option from this list, copied verbatim:",
    availableCategories.map((c) => `- ${c}`).join("\n"),
    "",
    `Purchase: "${description}"`,
    "",
    'Rules: Reply with ONLY the chosen category name, nothing else — no punctuation,',
    'no explanation. If you are unsure or nothing fits well, reply exactly "Other".',
  ].join("\n");

  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        // Deterministic classification: no creativity, tiny output.
        temperature: 0,
        maxOutputTokens: 20,
        // CRITICAL: gemini-2.5-flash is a *thinking* model — by default it spends
        // output tokens on hidden reasoning BEFORE the visible answer, and those
        // thinking tokens count against maxOutputTokens. With our tiny 20-token cap
        // the whole budget was consumed by thinking, so the call returned
        // finishReason=MAX_TOKENS with EMPTY visible text (response.text === undefined)
        // — which our `if (!raw) return fallback` then turned into "Other" for inputs
        // Gemini actually classifies correctly (e.g. "Zomato" → "Dining"). Disabling
        // thinking (budget 0) is exactly right for a one-word classifier and leaves the
        // full 20 tokens for the answer. See /DECISIONS.md (2026-06-21).
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const raw = response.text;
    if (!raw) return fallback;
    const cleaned = cleanModelLabel(raw);

    // Re-validate against our list (case-insensitive) and return canonical casing.
    const match = availableCategories.find(
      (c) => c.toLowerCase() === cleaned.toLowerCase(),
    );
    return match ?? fallback;
  } catch (err) {
    console.error("[gemini.matchCategory] falling back to Other:", err);
    return fallback;
  }
}

/** Plain-rupee formatter for the deterministic fallback string (no paise). */
function formatRupees(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Build the deterministic, Gemini-free explanation used both as the failure fallback
 * and as the basis the model is told to phrase from. Uses the top sanitized result's
 * exact numbers — never recomputes anything.
 */
function templateExplanation(
  category: string,
  ranked: AIRankedResult[],
): string {
  if (ranked.length === 0) {
    return `No active cards are available to rank for this ${category} purchase.`;
  }
  const top = ranked[0];
  return `Your best option is ${top.cardName} with an estimated ${formatRupees(
    top.totalExpectedValue,
  )} in rewards for this ${category} purchase (${formatRupees(
    top.directRewardValue,
  )} direct + ${formatRupees(top.milestoneContributionValue)} toward milestones).`;
}

/**
 * Phrase an ALREADY-COMPUTED ranked recommendation in 2–4 friendly sentences.
 *
 * `ranked` is the sanitized list (card names + the rupee figures we computed) — see
 * the SECURITY note at the top of this file; Gemini never sees raw rows or ids. The
 * prompt instructs the model in no uncertain terms to use the numbers VERBATIM and
 * to do no math of its own. On ANY failure (no key, network, rate limit, empty reply)
 * it returns {@link templateExplanation} built straight from those same numbers, so
 * the user still gets a correct, useful answer with Gemini offline.
 */
export async function explainRecommendation(
  purchaseDescription: string,
  category: string,
  ranked: AIRankedResult[],
): Promise<string> {
  if (ranked.length === 0) {
    // Nothing to explain and nothing for the model to add — skip the call entirely.
    return templateExplanation(category, ranked);
  }

  const lines = ranked
    .map(
      (r, i) =>
        `${i + 1}. ${r.cardName}: ${formatRupees(
          r.totalExpectedValue,
        )} total (${formatRupees(r.directRewardValue)} direct reward + ${formatRupees(
          r.milestoneContributionValue,
        )} milestone contribution)`,
    )
    .join("\n");

  const prompt = [
    "You are a friendly assistant inside a personal credit-card rewards app.",
    "The reward values below were ALREADY CALCULATED by the app. They are final.",
    "",
    `The user asked about: "${purchaseDescription.trim()}"`,
    `We classified this purchase as: ${category}`,
    "Ranked best card options (best first):",
    lines,
    "",
    "Write 2-4 short, warm, conversational sentences recommending the top card and",
    "briefly saying why it wins over the others.",
    "STRICT: Use ONLY the exact rupee figures shown above. Do NOT add, recompute,",
    "round differently, estimate, or invent any number. Do not mention these rules.",
  ].join("\n");

  try {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        temperature: 0.6,
        maxOutputTokens: 200,
        // Same thinking-token gotcha as matchCategory above: gemini-2.5-flash's hidden
        // reasoning eats into maxOutputTokens, so thinking could swallow part/all of the
        // 200-token budget and truncate (or empty) the explanation. This call only
        // *phrases* already-computed numbers — no reasoning needed — so disable thinking
        // and keep the full budget for prose. See /DECISIONS.md (2026-06-21).
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const text = response.text?.trim();
    return text && text.length > 0
      ? text
      : templateExplanation(category, ranked);
  } catch (err) {
    console.error(
      "[gemini.explainRecommendation] using template fallback:",
      err,
    );
    return templateExplanation(category, ranked);
  }
}
