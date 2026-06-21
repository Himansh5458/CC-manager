// Standalone smoke test for the MonthlySnapshots data-access layer.
//
// Run with: npx tsx src/lib/data/monthlySnapshots.test.ts
//
// NOTE: create/update mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data is
// left untouched regardless of pass/fail. (Seed has snapshots empty by design.)

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getMonthlySnapshots,
  getSnapshotsByCardId,
  getLatestSnapshotForCard,
  createMonthlySnapshot,
  updateMonthlySnapshot,
} from "./monthlySnapshots";
import type { MonthlySnapshot } from "../types/schema";

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

function draft(cardId: string, start: string, end: string): Omit<MonthlySnapshot, "id"> {
  return {
    card_id: cardId,
    cycle_start_date: start,
    cycle_end_date: end,
    total_spend: 10000,
    category_breakdown_json: '{"Dining":10000}',
    predicted_next_bill: 10000,
    anomaly_flags_json: "[]",
    manual_override_predicted_bill: null,
  };
}

async function main(): Promise<void> {
  const backup = await fs.readFile(DB_PATH, "utf-8");

  try {
    const all = await getMonthlySnapshots();
    check("getMonthlySnapshots() returns an array", Array.isArray(all));
    const seedCount = all.length;

    check(
      "getLatestSnapshotForCard() returns null when card has no snapshots",
      (await getLatestSnapshotForCard("card-millennia-001")) === null,
    );

    // Create two snapshots for the same card with different cycle_end_dates.
    const older = await createMonthlySnapshot(draft("card-millennia-001", "2026-04-01", "2026-04-30"));
    const newer = await createMonthlySnapshot(draft("card-millennia-001", "2026-05-01", "2026-05-31"));
    // And one for a different card, to confirm filtering.
    await createMonthlySnapshot(draft("card-atlas-001", "2026-05-01", "2026-05-31"));

    check(
      "createMonthlySnapshot() returns a row with a generated id",
      typeof older.id === "string" && older.id.length > 0,
    );

    const afterCreate = await getMonthlySnapshots();
    check("createMonthlySnapshot() persists (count + 3)", afterCreate.length === seedCount + 3);

    const byCard = await getSnapshotsByCardId("card-millennia-001");
    check("getSnapshotsByCardId() returns only that card's snapshots", byCard.length === 2);

    // getLatestSnapshotForCard returns the one with the most recent cycle_end_date.
    const latest = await getLatestSnapshotForCard("card-millennia-001");
    check("getLatestSnapshotForCard() returns the most recent by cycle_end_date", latest?.id === newer.id);

    // updateMonthlySnapshot
    const updated = await updateMonthlySnapshot(newer.id, { total_spend: 25000 });
    check("updateMonthlySnapshot() returns updated row", updated?.total_spend === 25000);
    check("updateMonthlySnapshot() keeps id immutable", updated?.id === newer.id);

    const updateMissing = await updateMonthlySnapshot("does-not-exist", { total_spend: 1 });
    check("updateMonthlySnapshot(invalid id) returns null", updateMissing === null);
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
