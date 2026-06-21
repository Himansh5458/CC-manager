// Standalone unit test for the card balance / utilization business logic.
//
// Run with: npx tsx src/lib/calculations/cardBalance.test.ts
//
// PURE logic (no database I/O), so — like milestoneCycles.test.ts — it does not
// snapshot/restore data/database.json. It builds Card/Transaction/Payment
// fixtures in memory (mirroring the real seed cards) and asserts on
// recomputeCardBalance / mostRecentStatementDate / getEffectiveUtilization.

import {
  recomputeCardBalance,
  mostRecentStatementDate,
  getEffectiveUtilization,
} from "./cardBalance";
import type { Card, Transaction, Payment } from "../types/schema";

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

function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Card fixture; only the fields the balance logic reads are meaningful, the rest
// are filler to satisfy the type.
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

function makeTxn(overrides: Partial<Transaction>): Transaction {
  return {
    id: "txn-test",
    card_id: "card-test",
    date: "2026-06-10",
    merchant: "Test Merchant",
    amount: 0,
    category: "Other",
    notes: "",
    source: "manual",
    statement_file_id: null,
    confidence_flag: "high",
    manual_override_category: null,
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment>): Payment {
  return {
    id: "pay-test",
    card_id: "card-test",
    date: "2026-06-10",
    amount: 0,
    source: "UPI",
    ...overrides,
  };
}

const TODAY = utc("2026-06-21");

function main(): void {
  // ── mostRecentStatementDate: the trickiest date logic ───────────────────────
  check(
    "mostRecentStatementDate(5, 2026-06-21) -> 2026-06-05 (this month, day passed)",
    toISODate(mostRecentStatementDate(5, TODAY)) === "2026-06-05",
  );
  check(
    "mostRecentStatementDate(18, 2026-06-21) -> 2026-06-18 (this month, day passed)",
    toISODate(mostRecentStatementDate(18, TODAY)) === "2026-06-18",
  );
  check(
    "mostRecentStatementDate(18, 2026-06-10) -> 2026-05-18 (today before this month's date, step back)",
    toISODate(mostRecentStatementDate(18, utc("2026-06-10"))) === "2026-05-18",
  );
  check(
    "mostRecentStatementDate(5, 2026-06-05) -> 2026-06-05 (exactly on statement day)",
    toISODate(mostRecentStatementDate(5, utc("2026-06-05"))) === "2026-06-05",
  );
  check(
    "mostRecentStatementDate(31, 2026-03-10) -> 2026-02-28 (short-month clamp back, non-leap)",
    toISODate(mostRecentStatementDate(31, utc("2026-03-10"))) === "2026-02-28",
  );
  check(
    "mostRecentStatementDate(31, 2028-03-10) -> 2028-02-29 (short-month clamp back, leap)",
    toISODate(mostRecentStatementDate(31, utc("2028-03-10"))) === "2028-02-29",
  );
  check(
    "mostRecentStatementDate(15, 2026-01-05) -> 2025-12-15 (step back across year boundary)",
    toISODate(mostRecentStatementDate(15, utc("2026-01-05"))) === "2025-12-15",
  );

  // ── HDFC Millennia (statement_date 5, limit 200000) reproduces seed values ──
  // Seed says current_outstanding_balance 8190, current_utilization_pct 4.1 as of
  // 2026-06-21. Cycle starts 2026-06-05, so the 5 June spends count and both
  // pre-June-5 payments are excluded.
  const millennia = makeCard({
    id: "card-millennia-001",
    statement_date: 5,
    credit_limit: 200000,
  });
  const millenniaTxns: Transaction[] = [
    makeTxn({ id: "t1", card_id: "card-millennia-001", date: "2026-06-06", amount: 850 }),
    makeTxn({ id: "t2", card_id: "card-millennia-001", date: "2026-06-08", amount: 3200 }),
    makeTxn({ id: "t3", card_id: "card-millennia-001", date: "2026-06-10", amount: 1500 }),
    makeTxn({ id: "t4", card_id: "card-millennia-001", date: "2026-06-14", amount: 2000 }),
    makeTxn({ id: "t5", card_id: "card-millennia-001", date: "2026-06-18", amount: 640 }),
  ];
  const millenniaPayments: Payment[] = [
    // Both before the 2026-06-05 cycle start → excluded.
    makePayment({ id: "p1", card_id: "card-millennia-001", date: "2026-05-28", amount: 5000 }),
    makePayment({ id: "p2", card_id: "card-millennia-001", date: "2026-06-02", amount: 12000 }),
  ];
  const mill = recomputeCardBalance(millennia, millenniaTxns, millenniaPayments, TODAY);
  check(
    "HDFC Millennia outstanding == seed 8190 (pre-cycle payments excluded)",
    mill.outstandingBalance === 8190,
  );
  check(
    "HDFC Millennia utilization == seed 4.1 (8190/200000*100 rounded 1dp)",
    mill.utilizationPct === 4.1,
  );

  // ── Axis Atlas (statement_date 18, limit 150000) reproduces seed values ─────
  // Seed says 33980 / 22.7 as of 2026-06-21. Cycle starts 2026-06-18; the
  // 18 June travel spend sits exactly on the boundary and must be INCLUDED, while
  // the 15 June payment falls before the cycle and must be EXCLUDED.
  const atlas = makeCard({
    id: "card-atlas-001",
    statement_date: 18,
    credit_limit: 150000,
  });
  const atlasTxns: Transaction[] = [
    makeTxn({ id: "t6", card_id: "card-atlas-001", date: "2026-06-18", amount: 18000 }),
    makeTxn({ id: "t7", card_id: "card-atlas-001", date: "2026-06-19", amount: 9500 }),
    makeTxn({ id: "t8", card_id: "card-atlas-001", date: "2026-06-19", amount: 480 }),
    makeTxn({ id: "t9", card_id: "card-atlas-001", date: "2026-06-20", amount: 5400 }),
    makeTxn({ id: "t10", card_id: "card-atlas-001", date: "2026-06-20", amount: 600 }),
  ];
  const atlasPayments: Payment[] = [
    makePayment({ id: "p3", card_id: "card-atlas-001", date: "2026-06-15", amount: 25000 }),
  ];
  const atl = recomputeCardBalance(atlas, atlasTxns, atlasPayments, TODAY);
  check(
    "Axis Atlas outstanding == seed 33980 (boundary 06-18 spend included, pre-cycle payment excluded)",
    atl.outstandingBalance === 33980,
  );
  check(
    "Axis Atlas utilization == seed 22.7 (33980/150000*100 rounded 1dp)",
    atl.utilizationPct === 22.7,
  );

  // ── Cross-card isolation: other cards' rows must not leak in ─────────────────
  const mixedTxns = [
    ...millenniaTxns,
    makeTxn({ id: "tx", card_id: "card-atlas-001", date: "2026-06-19", amount: 99999 }),
  ];
  const millIsolated = recomputeCardBalance(millennia, mixedTxns, [], TODAY);
  check(
    "recomputeCardBalance only counts the card's own transactions",
    millIsolated.outstandingBalance === 8190,
  );

  // ── Statement-cycle boundary: exact-edge inclusion/exclusion ────────────────
  // statement_date 5, today 2026-06-21 -> cycle start 2026-06-05.
  const edgeCard = makeCard({ id: "edge", statement_date: 5, credit_limit: 100000 });
  const edgeTxns: Transaction[] = [
    makeTxn({ id: "on", card_id: "edge", date: "2026-06-05", amount: 100 }), // ON start -> in
    makeTxn({ id: "before", card_id: "edge", date: "2026-06-04", amount: 999 }), // day before -> out
    makeTxn({ id: "after", card_id: "edge", date: "2026-06-20", amount: 200 }), // in
  ];
  const edgePayments: Payment[] = [
    makePayment({ id: "pon", card_id: "edge", date: "2026-06-05", amount: 50 }), // ON start -> in
    makePayment({ id: "pbefore", card_id: "edge", date: "2026-06-04", amount: 70 }), // day before -> out
  ];
  const edge = recomputeCardBalance(edgeCard, edgeTxns, edgePayments, TODAY);
  check(
    "boundary: txn on cycle-start day included, prior day excluded; payment on start subtracted, prior excluded -> (100+200)-50 == 250",
    edge.outstandingBalance === 250,
  );

  // ── Decimal rounding of utilization (1 dp) ──────────────────────────────────
  const roundCard = makeCard({ id: "round", statement_date: 5, credit_limit: 30000 });
  // 5000/30000*100 = 16.666... -> 16.7
  const roundOut = recomputeCardBalance(
    roundCard,
    [makeTxn({ id: "r", card_id: "round", date: "2026-06-10", amount: 5000 })],
    [],
    TODAY,
  );
  check(
    "utilization rounds to 1 dp (16.666.. -> 16.7)",
    roundOut.utilizationPct === 16.7,
  );

  // ── credit_limit 0 guard: no NaN/Infinity ───────────────────────────────────
  const zeroLimit = makeCard({ id: "zero", statement_date: 5, credit_limit: 0 });
  const zeroOut = recomputeCardBalance(
    zeroLimit,
    [makeTxn({ id: "z", card_id: "zero", date: "2026-06-10", amount: 500 })],
    [],
    TODAY,
  );
  check(
    "credit_limit 0 -> utilization 0 (not NaN/Infinity), balance still computed",
    zeroOut.utilizationPct === 0 && zeroOut.outstandingBalance === 500,
  );

  // ── getEffectiveUtilization: manual override always wins ─────────────────────
  const computed = { outstandingBalance: 8190, utilizationPct: 4.1 };
  check(
    "getEffectiveUtilization returns computed when override is null",
    getEffectiveUtilization(makeCard({ manual_override_utilization_pct: null }), computed) === 4.1,
  );
  check(
    "getEffectiveUtilization returns override when set (override wins)",
    getEffectiveUtilization(makeCard({ manual_override_utilization_pct: 12.5 }), computed) === 12.5,
  );
  check(
    "getEffectiveUtilization respects an override of 0 (non-null falsy value wins, not computed)",
    getEffectiveUtilization(makeCard({ manual_override_utilization_pct: 0 }), computed) === 0,
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
