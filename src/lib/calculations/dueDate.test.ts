// Standalone unit test for the payment-due-date business logic.
//
// Run with: npx tsx src/lib/calculations/dueDate.test.ts
//
// PURE logic (no database I/O), so — like cardBalance.test.ts — it does not
// snapshot/restore data/database.json. It builds Card fixtures in memory
// (mirroring the real seed cards) and asserts on daysUntilDue.

import { daysUntilDue } from "./dueDate";
import type { Card } from "../types/schema";

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

function utc(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function makeCard(overrides: Partial<Card>): Card {
  return {
    id: "card-test",
    card_holder: "Test Holder",
    card_name: "Test Card",
    card_bank: "TestBank",
    card_type: "Visa",
    card_number_encrypted: "PLACEHOLDER_NOT_ENCRYPTED",
    card_number_last4: "0000",
    expiry_month: 1,
    expiry_year: 2030,
    registered_phone: "+91-0000000000",
    registered_email: "test@example.com",
    annual_fee: 0,
    statement_date: 5,
    payment_deadline_days: 20,
    customer_care_number: "0000",
    credit_limit: 100000,
    renewal_date: "2030-01-01",
    issuance_date: "2024-01-01",
    benefits_summary: "",
    parent_family: "TestBank Test Holder",
    current_outstanding_balance: 0,
    current_utilization_pct: 0,
    manual_override_utilization_pct: null,
    active: true,
    ...overrides,
  };
}

const TODAY = utc("2026-06-21");

function main(): void {
  // ── Seed cards reproduce the Cards-page figures as of 2026-06-21 ─────────────
  // HDFC Millennia: statement 5 -> 2026-06-05, +20 days = 2026-06-25 -> 4 days out.
  const millennia = makeCard({
    id: "card-millennia-001",
    statement_date: 5,
    payment_deadline_days: 20,
  });
  check(
    "HDFC Millennia (statement 5, +20d) is due in 4 days as of 2026-06-21",
    daysUntilDue(millennia, TODAY) === 4,
  );

  // Axis Atlas: statement 18 -> 2026-06-18, +18 days = 2026-07-06 -> 15 days out.
  const atlas = makeCard({
    id: "card-atlas-001",
    statement_date: 18,
    payment_deadline_days: 18,
  });
  check(
    "Axis Atlas (statement 18, +18d) is due in 15 days as of 2026-06-21",
    daysUntilDue(atlas, TODAY) === 15,
  );

  // ── Exact-deadline boundary: today == due day -> 0, not null ─────────────────
  check(
    "deadline falling exactly on today returns 0 (not null)",
    daysUntilDue(millennia, utc("2026-06-25")) === 0,
  );

  // ── Passed deadline returns null (caller handles the fallback) ───────────────
  // statement 5 -> 2026-06-05, +20d = 2026-06-25; today 2026-06-26 is past it, and
  // this month's statement (06-05) is the most recent, so no future deadline yet.
  check(
    "a deadline already in the past returns null",
    daysUntilDue(millennia, utc("2026-06-26")) === null,
  );

  // ── Year-boundary step-back still yields a sane positive count ───────────────
  // statement 28 -> most recent ≤ 2026-01-02 is 2025-12-28, +20d = 2026-01-17 -> 15.
  const yearEdge = makeCard({ statement_date: 28, payment_deadline_days: 20 });
  check(
    "statement-date step-back across the year boundary counts forward correctly (15 days)",
    daysUntilDue(yearEdge, utc("2026-01-02")) === 15,
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
