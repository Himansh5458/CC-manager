// Standalone smoke test for the Exclusions data-access layer.
//
// Run with: npx tsx src/lib/data/exclusions.test.ts
//
// NOTE: create/delete mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data is
// left untouched regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getExclusions,
  getExclusionsByCardId,
  createExclusion,
  deleteExclusion,
} from "./exclusions";
import type { Exclusion } from "../types/schema";

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
    const all = await getExclusions();
    check("getExclusions() returns an array", Array.isArray(all));
    const seedCount = all.length;

    const byCard = await getExclusionsByCardId("card-millennia-001");
    check(
      "getExclusionsByCardId() returns only that card's exclusions",
      byCard.every((e) => e.card_id === "card-millennia-001"),
    );

    const none = await getExclusionsByCardId("does-not-exist");
    check("getExclusionsByCardId(unknown) returns []", none.length === 0);

    // createExclusion
    const draft: Omit<Exclusion, "id"> = {
      card_id: "card-millennia-001",
      excluded_category: "Rent",
      applies_to: "all_rewards",
      notes: "Rent never earns rewards",
      source_dump_text: "Rent excluded from all rewards",
      extracted_date: "2026-06-21",
    };
    const created = await createExclusion(draft);
    check(
      "createExclusion() returns a row with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check("createExclusion() preserves passed fields", created.excluded_category === "Rent");

    const afterCreate = await getExclusions();
    check("createExclusion() persists (count + 1)", afterCreate.length === seedCount + 1);

    const refetched = await getExclusionsByCardId("card-millennia-001");
    check(
      "createExclusion() persisted row is retrievable",
      refetched.some((e) => e.id === created.id),
    );

    // deleteExclusion
    const deleted = await deleteExclusion(created.id);
    check("deleteExclusion() returns true", deleted === true);

    const afterDelete = await getExclusions();
    check("deleteExclusion() persists (back to seed count)", afterDelete.length === seedCount);

    const deleteMissing = await deleteExclusion("does-not-exist");
    check("deleteExclusion(invalid id) returns false", deleteMissing === false);
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
