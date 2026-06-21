"use client";

// AssistantChat — the interactive half of the AI Assistant page (see src/app/CLAUDE.md
// "Assistant pattern"). Client Component only because it needs React 19's
// `useActionState` (pending/result state) plus a little local state to accumulate the
// on-screen conversation history. It owns NO business logic: it posts to
// `getRecommendationAction`, which classifies (Gemini), ranks (deterministic math), and
// explains (Gemini), then renders the returned numbers.
//
// UX choice (documented): TWO separate inputs — a free-text "what are you buying?" and a
// numeric amount — rather than one combined "₹500 on Swiggy" box. Rationale: the amount
// must stay a reliable, deterministic number; parsing it out of free text would either
// need brittle regex or ask Gemini to read a figure, and the whole design keeps Gemini
// away from numbers. Splitting the fields keeps the amount exact and the description free
// for Gemini to classify. It also matches the app's existing Forms pattern (explicit
// amount field). Inputs are uncontrolled; the form is reset only on a successful answer.

import { useActionState, useEffect, useId, useRef, useState } from "react";
import {
  getRecommendationAction,
  type AssistantState,
} from "../actions";
import type { ExpectedCashback } from "@/lib/calculations/expectedCashback";

// Initial useActionState value. Defined HERE, never imported from the "use server"
// actions file — a non-function export does not survive the RSC boundary and would
// leave the state object as a proxy, breaking first render (src/app/CLAUDE.md GOTCHA).
const INITIAL_STATE: AssistantState = {
  ok: false,
  error: null,
  submitted: null,
  category: null,
  results: [],
  cardNames: {},
  explanation: null,
};

// One settled conversation turn shown in the history list.
type HistoryEntry = {
  description: string;
  amount: number;
  category: string;
  results: ExpectedCashback[];
  cardNames: Record<string, string>;
  explanation: string;
};

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-background-dark px-3 py-2 text-sm text-text-primary-dark placeholder:text-text-secondary-dark focus:border-brand-yellow focus:outline-none focus:ring-1 focus:ring-brand-yellow";
const labelClass =
  "mb-1 block text-xs font-medium uppercase tracking-wide text-text-secondary-dark";

function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Precise rupee figure (2dp) for the per-card reward breakdown rows. */
function formatINR2(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function AssistantChat() {
  const [state, formAction, pending] = useActionState(
    getRecommendationAction,
    INITIAL_STATE,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId();

  // Conversation history accumulates across submits. useActionState only holds the
  // LATEST result, so we append each successful one to local state.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Append exactly once per settled state object: each submit yields a NEW state
  // reference, so tracking the last-appended reference guards against any double-run
  // (e.g. React strict-mode effect replays) appending a turn twice.
  const lastAppended = useRef<AssistantState | null>(null);

  useEffect(() => {
    if (state.ok && state !== lastAppended.current && state.submitted) {
      lastAppended.current = state;
      setHistory((h) => [
        ...h,
        {
          description: state.submitted!.description,
          amount: state.submitted!.amount,
          category: state.category ?? "Other",
          results: state.results,
          cardNames: state.cardNames,
          explanation: state.explanation ?? "",
        },
      ]);
      formRef.current?.reset();
    }
  }, [state]);

  return (
    <div className="space-y-6">
      {/* Conversation history (oldest first) */}
      {(history.length > 0 || pending) && (
        <div className="space-y-4">
          {history.map((entry, i) => (
            <ConversationTurn key={i} entry={entry} />
          ))}
          {pending && <ThinkingTurn submitted={state.submitted} />}
        </div>
      )}

      {/* Ask form */}
      <form
        ref={formRef}
        action={formAction}
        className="rounded-2xl border border-white/5 bg-surface-dark p-6 shadow-lg shadow-black/20"
        noValidate
      >
        <h2 className="text-lg font-semibold text-text-primary-dark">
          Which card should I use?
        </h2>
        <p className="mt-1 text-sm text-text-secondary-dark">
          Describe the purchase and the amount — I’ll match a category and rank your
          cards by expected reward.
        </p>

        {state.error && !pending && (
          <p
            role="status"
            className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
          >
            {state.error}
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor={`${formId}-desc`} className={labelClass}>
              What are you buying?
            </label>
            <input
              id={`${formId}-desc`}
              type="text"
              name="description"
              placeholder="e.g. dinner on Swiggy"
              autoComplete="off"
              className={fieldClass}
            />
          </div>
          <div className="sm:w-40">
            <label htmlFor={`${formId}-amount`} className={labelClass}>
              Amount (₹)
            </label>
            <input
              id={`${formId}-amount`}
              type="number"
              name="amount"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="500"
              className={`${fieldClass} tabular-nums`}
            />
          </div>
        </div>

        <div className="mt-6">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-brand-yellow px-5 py-2.5 text-sm font-semibold text-charcoal transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Thinking…" : "Ask"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** The question bubble shared by settled and in-flight turns. */
function QuestionBubble({
  description,
  amount,
}: {
  description: string;
  amount: number;
}) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-brand-yellow/10 px-4 py-2.5 text-sm text-text-primary-dark">
        <span className="font-medium">{formatINR(amount)}</span> · {description}
      </div>
    </div>
  );
}

/** A settled turn: the question, the matched category, the ranked cards, the prose. */
function ConversationTurn({ entry }: { entry: HistoryEntry }) {
  return (
    <div className="space-y-3">
      <QuestionBubble description={entry.description} amount={entry.amount} />

      <div className="rounded-2xl rounded-bl-sm border border-white/5 bg-surface-dark p-5 shadow-lg shadow-black/20">
        {/* Matched category */}
        <div className="flex items-center gap-2 text-xs text-text-secondary-dark">
          <span className="uppercase tracking-wide">Category</span>
          <span className="rounded-full bg-brand-yellow/15 px-2.5 py-0.5 text-xs font-semibold text-brand-yellow">
            {entry.category}
          </span>
        </div>

        {/* Ranked cards with breakdown */}
        {entry.results.length === 0 ? (
          <p className="mt-4 text-sm text-text-secondary-dark">
            No active cards available to rank.
          </p>
        ) : (
          <ol className="mt-4 space-y-2">
            {entry.results.map((r, i) => (
              <li
                key={r.cardId}
                className={`rounded-xl border px-4 py-3 ${
                  i === 0
                    ? "border-brand-yellow/40 bg-brand-yellow/5"
                    : "border-white/5 bg-background-dark"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        i === 0
                          ? "bg-brand-yellow text-charcoal"
                          : "bg-white/10 text-text-secondary-dark"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="text-sm font-semibold text-text-primary-dark">
                      {entry.cardNames[r.cardId] ?? "Unknown card"}
                    </span>
                  </div>
                  <span className="text-sm font-bold tabular-nums text-text-primary-dark">
                    {formatINR2(r.totalExpectedValue)}
                  </span>
                </div>
                <div className="mt-1.5 flex gap-4 pl-[2.125rem] text-xs text-text-secondary-dark tabular-nums">
                  <span>Direct {formatINR2(r.directRewardValue)}</span>
                  <span>
                    Milestone {formatINR2(r.milestoneContributionValue)}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Conversational explanation */}
        {entry.explanation && (
          <p className="mt-4 border-t border-white/5 pt-4 text-sm leading-relaxed text-text-primary-dark">
            {entry.explanation}
          </p>
        )}
      </div>
    </div>
  );
}

/** In-flight turn: shows the question optimistically + an animated "thinking" line. */
function ThinkingTurn({
  submitted,
}: {
  submitted: { description: string; amount: number } | null;
}) {
  return (
    <div className="space-y-3">
      {submitted && (
        <QuestionBubble
          description={submitted.description}
          amount={submitted.amount}
        />
      )}
      <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-white/5 bg-surface-dark px-5 py-4 text-sm text-text-secondary-dark">
        <span className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-yellow [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-yellow [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-brand-yellow" />
        </span>
        Thinking — matching a category and ranking your cards…
      </div>
    </div>
  );
}
