// Standalone smoke test for the FeesAndCharges data-access layer.
//
// Run with: npx tsx src/lib/data/feesAndCharges.test.ts
//
// NOTE: create/update/delete mutate /data/database.json. This script snapshots the
// file before running and restores it in a finally block, so the committed seed
// data is left untouched regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getFeesAndCharges,
  getFeesByCardId,
  createFeeAndCharge,
  updateFeeAndCharge,
  deleteFeeAndCharge,
} from "./feesAndCharges";
import type { FeeAndCharge } from "../types/schema";

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
    const all = await getFeesAndCharges();
    check("getFeesAndCharges() returns an array", Array.isArray(all));
    const seedCount = all.length;

    // getFeesByCardId filters to one card
    const millenniaFees = await getFeesByCardId("card-millennia-001");
    check(
      "getFeesByCardId() returns only that card's fees",
      millenniaFees.every((f) => f.card_id === "card-millennia-001"),
    );

    const noFees = await getFeesByCardId("does-not-exist");
    check("getFeesByCardId(unknown) returns []", noFees.length === 0);

    // createFeeAndCharge
    const draft: Omit<FeeAndCharge, "id"> = {
      card_id: "card-millennia-001",
      fee_type: "late_payment",
      amount_or_rate: 500,
      waiver_condition: "Pay minimum due by deadline",
      source_dump_text: "Late payment fee Rs.500",
      extracted_date: "2026-06-21",
    };
    const created = await createFeeAndCharge(draft);
    check(
      "createFeeAndCharge() returns a row with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check("createFeeAndCharge() preserves passed fields", created.amount_or_rate === 500);

    const afterCreate = await getFeesAndCharges();
    check("createFeeAndCharge() persists (count + 1)", afterCreate.length === seedCount + 1);

    // updateFeeAndCharge
    const updated = await updateFeeAndCharge(created.id, { amount_or_rate: 750 });
    check("updateFeeAndCharge() returns updated row", updated?.amount_or_rate === 750);
    check("updateFeeAndCharge() keeps id immutable", updated?.id === created.id);

    const updateMissing = await updateFeeAndCharge("does-not-exist", { amount_or_rate: 1 });
    check("updateFeeAndCharge(invalid id) returns null", updateMissing === null);

    // deleteFeeAndCharge
    const deleted = await deleteFeeAndCharge(created.id);
    check("deleteFeeAndCharge() returns true", deleted === true);

    const afterDelete = await getFeesAndCharges();
    check("deleteFeeAndCharge() persists (back to seed count)", afterDelete.length === seedCount);

    const deleteMissing = await deleteFeeAndCharge("does-not-exist");
    check("deleteFeeAndCharge(invalid id) returns false", deleteMissing === false);
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
