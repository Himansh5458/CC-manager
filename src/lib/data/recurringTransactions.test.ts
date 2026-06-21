// Standalone smoke test for the RecurringTransactions data-access layer.
//
// Run with: npx tsx src/lib/data/recurringTransactions.test.ts
//
// NOTE: create/update mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data is
// left untouched (still exactly 2 recurring transactions) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getRecurringTransactions,
  getActiveRecurringTransactions,
  createRecurringTransaction,
  updateRecurringTransaction,
} from "./recurringTransactions";
import type { RecurringTransaction } from "../types/schema";

const DB_PATH = path.join(process.cwd(), "data", "database.json");

// Seed data: rec-001 "Netflix" (active, end_date null) and rec-002 "Term Insurance
// EMI" (active, end_date 2030-04-05). Whether the term-insurance EMI counts as active
// depends on today's date, so predict the expectation rather than hard-coding it —
// this keeps the test correct even after 2030-04-05 passes.
const TERM_INSURANCE_END = "2030-04-05";

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

async function main(): Promise<void> {
  const backup = await fs.readFile(DB_PATH, "utf-8");

  try {
    // 1. getRecurringTransactions returns the 2 seed rows
    const all = await getRecurringTransactions();
    check("getRecurringTransactions() returns 2 rows", all.length === 2);

    // 2. getActiveRecurringTransactions — predict based on today's date.
    const today = new Date().toISOString().slice(0, 10);
    const termInsuranceStillActive = TERM_INSURANCE_END >= today; // true while today <= 2030-04-05
    const expectedActiveCount = termInsuranceStillActive ? 2 : 1; // Netflix (indefinite) is always active

    const active = await getActiveRecurringTransactions();
    check(
      `getActiveRecurringTransactions() returns ${expectedActiveCount} (today=${today})`,
      active.length === expectedActiveCount,
    );

    const hasTermInsurance = active.some((rt) => rt.nickname === "Term Insurance EMI");
    check(
      "getActiveRecurringTransactions() includes/excludes term insurance per its end_date",
      hasTermInsurance === termInsuranceStillActive,
    );

    const hasNetflix = active.some((rt) => rt.nickname === "Netflix");
    check("getActiveRecurringTransactions() always includes the indefinite Netflix", hasNetflix);

    // 3. Active filter excludes inactive rows even when end_date is in the future.
    const draftInactive: Omit<RecurringTransaction, "id"> = {
      nickname: "Cancelled Gym",
      card_id: "card-millennia-001",
      amount: 1200,
      category: "Health",
      billing_day: 1,
      start_date: "2025-01-01",
      end_date: "2099-01-01",
      active: false,
    };
    const inactive = await createRecurringTransaction(draftInactive);
    const activeAfterInactive = await getActiveRecurringTransactions();
    check(
      "getActiveRecurringTransactions() excludes active===false rows",
      !activeAfterInactive.some((rt) => rt.id === inactive.id),
    );

    // 4. Active filter excludes rows whose end_date is in the past.
    const draftExpired: Omit<RecurringTransaction, "id"> = {
      nickname: "Old Subscription",
      card_id: "card-millennia-001",
      amount: 99,
      category: "Entertainment",
      billing_day: 1,
      start_date: "2020-01-01",
      end_date: "2020-12-31",
      active: true,
    };
    const expired = await createRecurringTransaction(draftExpired);
    const activeAfterExpired = await getActiveRecurringTransactions();
    check(
      "getActiveRecurringTransactions() excludes past end_date rows",
      !activeAfterExpired.some((rt) => rt.id === expired.id),
    );

    // 5. createRecurringTransaction persisted (now 4 total) with generated ids
    const afterCreate = await getRecurringTransactions();
    check("createRecurringTransaction() persists (now 4)", afterCreate.length === 4);
    check(
      "createRecurringTransaction() returns generated id + preserved fields",
      typeof inactive.id === "string" && inactive.nickname === "Cancelled Gym",
    );

    // 6. updateRecurringTransaction modifies, keeps id immutable, handles invalid id
    const updated = await updateRecurringTransaction(inactive.id, { active: true });
    check("updateRecurringTransaction() returns updated row", updated?.active === true);
    check("updateRecurringTransaction() keeps id immutable", updated?.id === inactive.id);

    const reread = (await getRecurringTransactions()).find((rt) => rt.id === inactive.id);
    check("updateRecurringTransaction() change is persisted", reread?.active === true);

    const updateMissing = await updateRecurringTransaction("does-not-exist", { amount: 1 });
    check("updateRecurringTransaction(invalid id) returns null", updateMissing === null);
  } finally {
    await fs.writeFile(DB_PATH, backup, "utf-8");
    console.log("\nRestored data/database.json to its pre-test state.");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
