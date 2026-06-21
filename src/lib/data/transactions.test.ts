// Standalone smoke test for the Transactions data-access layer.
//
// Run with: npx tsx src/lib/data/transactions.test.ts
//
// NOTE: create/update/delete mutate /data/database.json. This script snapshots the
// file before running and restores it in a finally block, so the committed seed data
// is left untouched (still exactly 11 transactions) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getTransactions,
  getTransactionsByCardId,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "./transactions";
import type { Transaction } from "../types/schema";

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
    // 1. getTransactions returns the 11 seed transactions
    const all = await getTransactions();
    check("getTransactions() returns 11 transactions", all.length === 11);

    // 2. getTransactionsByCardId splits correctly (5 Millennia, 6 Atlas in seed data)
    const millennia = await getTransactionsByCardId("card-millennia-001");
    check("getTransactionsByCardId(millennia) returns 5", millennia.length === 5);

    const atlas = await getTransactionsByCardId("card-atlas-001");
    check("getTransactionsByCardId(atlas) returns 6", atlas.length === 6);

    const none = await getTransactionsByCardId("does-not-exist");
    check("getTransactionsByCardId(unknown) returns []", none.length === 0);

    // 3. createTransaction adds a transaction and persists it
    const draft: Omit<Transaction, "id"> = {
      card_id: "card-millennia-001",
      date: "2026-06-21",
      merchant: "Uber",
      amount: 320,
      category: "Travel",
      notes: "Cab ride",
      source: "manual",
      statement_file_id: null,
      confidence_flag: "high",
      manual_override_category: null,
    };
    const created = await createTransaction(draft);
    check(
      "createTransaction() returns a transaction with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check(
      "createTransaction() preserves passed fields",
      created.merchant === "Uber" && created.amount === 320,
    );

    const afterCreate = await getTransactions();
    check("createTransaction() persists (now 12)", afterCreate.length === 12);

    // 4. updateTransaction modifies a field correctly and persists
    const updated = await updateTransaction(created.id, { amount: 999 });
    check("updateTransaction() returns updated row", updated?.amount === 999);
    check("updateTransaction() keeps id immutable", updated?.id === created.id);

    const reread = (await getTransactions()).find((t) => t.id === created.id);
    check("updateTransaction() change is persisted", reread?.amount === 999);

    const updateMissing = await updateTransaction("does-not-exist", { amount: 1 });
    check("updateTransaction(invalid id) returns null", updateMissing === null);

    // 5. deleteTransaction removes valid id, rejects invalid id
    const deleted = await deleteTransaction(created.id);
    check("deleteTransaction(valid id) returns true", deleted === true);

    const afterDelete = await getTransactions();
    check("deleteTransaction() persists (back to 11)", afterDelete.length === 11);

    const deleteMissing = await deleteTransaction("does-not-exist");
    check("deleteTransaction(invalid id) returns false", deleteMissing === false);
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
