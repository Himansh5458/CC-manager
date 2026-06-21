// Standalone smoke test for the FamilyCapTracker data-access layer.
//
// Run with: npx tsx src/lib/data/familyCapTracker.test.ts
//
// This tab is STRUCTURALLY DIFFERENT from every other: no single `id` field, its
// primary key is the COMPOSITE (family_key + financial_year), and writes go through
// a single upsert. The key assertions below: upsert CREATES when no matching pair
// exists, and UPDATES IN PLACE (no duplicate) when called again with the same pair.
//
// NOTE: upsert mutates /data/database.json. This script snapshots the file before
// running and restores it in a finally block. (Seed has familyCapTracker empty.)

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getFamilyCapTrackers,
  getFamilyCapTracker,
  upsertFamilyCapTracker,
} from "./familyCapTracker";
import type { FamilyCapTracker } from "../types/schema";

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
    const all = await getFamilyCapTrackers();
    check("getFamilyCapTrackers() returns an array", Array.isArray(all));
    const seedCount = all.length;

    check(
      "getFamilyCapTracker(unknown pair) returns null",
      (await getFamilyCapTracker("HDFC Himansh", "2026-27")) === null,
    );

    // 1. upsert CREATES when no matching composite key exists.
    const initial: FamilyCapTracker = {
      family_key: "HDFC Himansh",
      financial_year: "2026-27",
      total_paid: 5000,
      cap_amount: 100000,
      remaining: 95000,
      manual_override_total_paid: null,
    };
    const createdResult = await upsertFamilyCapTracker(initial);
    check("upsert() returns the entry on create", createdResult.total_paid === 5000);

    const afterCreate = await getFamilyCapTrackers();
    check("upsert() created a new row (count + 1)", afterCreate.length === seedCount + 1);

    const fetched = await getFamilyCapTracker("HDFC Himansh", "2026-27");
    check("upsert()-created row is retrievable by composite key", fetched?.total_paid === 5000);

    // 2. upsert UPDATES IN PLACE (no duplicate) for the SAME composite key.
    const updatedEntry: FamilyCapTracker = {
      family_key: "HDFC Himansh",
      financial_year: "2026-27",
      total_paid: 12000,
      cap_amount: 100000,
      remaining: 88000,
      manual_override_total_paid: null,
    };
    await upsertFamilyCapTracker(updatedEntry);

    const afterUpdate = await getFamilyCapTrackers();
    check(
      "upsert() with same composite key does NOT create a duplicate",
      afterUpdate.length === seedCount + 1,
    );

    const reread = await getFamilyCapTracker("HDFC Himansh", "2026-27");
    check("upsert() updated the existing row's values", reread?.total_paid === 12000);
    check("upsert() updated remaining too", reread?.remaining === 88000);

    // 3. Same family_key, DIFFERENT financial_year => a distinct row (not an update).
    const nextFy: FamilyCapTracker = {
      family_key: "HDFC Himansh",
      financial_year: "2027-28",
      total_paid: 0,
      cap_amount: 100000,
      remaining: 100000,
      manual_override_total_paid: null,
    };
    await upsertFamilyCapTracker(nextFy);

    const afterSecondFy = await getFamilyCapTrackers();
    check(
      "upsert() with same family_key but different FY creates a separate row",
      afterSecondFy.length === seedCount + 2,
    );
    check(
      "previous-FY row is unchanged after adding a new FY row",
      (await getFamilyCapTracker("HDFC Himansh", "2026-27"))?.total_paid === 12000,
    );
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
