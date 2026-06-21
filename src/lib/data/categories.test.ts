// Standalone smoke test for the Categories data-access layer.
//
// Run with: npx tsx src/lib/data/categories.test.ts
//
// Category has no `id` — its identity is its `name`. The key assertion below is
// the duplicate-prevention logic: addCategory must NOT create a second row for a
// name that already exists (case-insensitive), and must return the existing one.
//
// NOTE: addCategory mutates /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so committed seed data is
// left untouched regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getCategories, addCategory } from "./categories";

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
    const seed = await getCategories();
    check("getCategories() returns an array", Array.isArray(seed));
    const seedCount = seed.length;
    check("seed has at least one category", seedCount > 0);

    // 1. Adding a brand-new category appends it.
    const fresh = await addCategory("Charity");
    check("addCategory(new) returns the created category", fresh.name === "Charity");

    const afterNew = await getCategories();
    check("addCategory(new) persists (count + 1)", afterNew.length === seedCount + 1);

    // 2. Adding the exact same name again does NOT create a duplicate.
    const dupExact = await addCategory("Charity");
    check("addCategory(exact duplicate) returns existing", dupExact.name === "Charity");

    const afterDupExact = await getCategories();
    check(
      "addCategory(exact duplicate) does not add a row (still count + 1)",
      afterDupExact.length === seedCount + 1,
    );

    // 3. Case-insensitive duplicate is also prevented.
    const dupCase = await addCategory("CHARITY");
    check("addCategory(case-variant) returns the existing row", dupCase.name === "Charity");

    const afterDupCase = await getCategories();
    check(
      "addCategory(case-variant duplicate) does not add a row",
      afterDupCase.length === seedCount + 1,
    );

    // 4. A duplicate of a pre-existing SEED category is also prevented.
    const existingSeedName = seed[0].name;
    await addCategory(existingSeedName.toUpperCase());
    const afterSeedDup = await getCategories();
    check(
      "addCategory(case-variant of existing seed category) does not add a row",
      afterSeedDup.length === seedCount + 1,
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
