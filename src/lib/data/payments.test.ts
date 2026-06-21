// Standalone smoke test for the Payments data-access layer.
//
// Run with: npx tsx src/lib/data/payments.test.ts
//
// NOTE: create/delete mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data is
// left untouched (still exactly 3 payments) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getPayments,
  getPaymentsByCardId,
  createPayment,
  deletePayment,
} from "./payments";
import type { Payment } from "../types/schema";

const DB_PATH = path.join(process.cwd(), "data", "database.json");

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
    // 1. getPayments returns the 3 seed payments
    const all = await getPayments();
    check("getPayments() returns 3 payments", all.length === 3);

    // 2. getPaymentsByCardId splits correctly (2 millennia, 1 atlas in seed data)
    const millennia = await getPaymentsByCardId("card-millennia-001");
    check("getPaymentsByCardId(millennia) returns 2", millennia.length === 2);

    const atlas = await getPaymentsByCardId("card-atlas-001");
    check("getPaymentsByCardId(atlas) returns 1", atlas.length === 1);

    const none = await getPaymentsByCardId("does-not-exist");
    check("getPaymentsByCardId(unknown) returns []", none.length === 0);

    // 3. createPayment adds a payment and persists it
    const draft: Omit<Payment, "id"> = {
      card_id: "card-atlas-001",
      date: "2026-06-21",
      amount: 7500,
      source: "UPI",
    };
    const created = await createPayment(draft);
    check(
      "createPayment() returns a payment with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check(
      "createPayment() preserves passed fields",
      created.amount === 7500 && created.source === "UPI",
    );

    const afterCreate = await getPayments();
    check("createPayment() persists (now 4)", afterCreate.length === 4);

    const refetched = (await getPaymentsByCardId("card-atlas-001")).find(
      (p) => p.id === created.id,
    );
    check("createPayment() persisted payment is retrievable", refetched?.amount === 7500);

    // 4. deletePayment removes valid id, rejects invalid id
    const deleted = await deletePayment(created.id);
    check("deletePayment(valid id) returns true", deleted === true);

    const afterDelete = await getPayments();
    check("deletePayment() persists (back to 3)", afterDelete.length === 3);

    const deleteMissing = await deletePayment("does-not-exist");
    check("deletePayment(invalid id) returns false", deleteMissing === false);
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
