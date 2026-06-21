// Standalone smoke test for the MilestoneTiers data-access layer.
//
// Run with: npx tsx src/lib/data/milestoneTiers.test.ts
//
// NOTE: create/update mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data
// is left untouched (still exactly 6 milestone tiers) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getMilestoneTiers,
  getTiersByMilestoneId,
  createMilestoneTier,
  updateMilestoneTier,
} from "./milestoneTiers";
import type { MilestoneTier } from "../types/schema";

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
    // 1. getMilestoneTiers returns the 6 seed tiers
    const all = await getMilestoneTiers();
    check("getMilestoneTiers() returns 6 tiers", all.length === 6);

    // 2. getTiersByMilestoneId filters correctly (3 per seed milestone)
    const millTiers = await getTiersByMilestoneId("ms-millennia-q");
    check("getTiersByMilestoneId(ms-millennia-q) returns 3", millTiers.length === 3);
    const atlasTiers = await getTiersByMilestoneId("ms-atlas-anniv");
    check("getTiersByMilestoneId(ms-atlas-anniv) returns 3", atlasTiers.length === 3);
    const none = await getTiersByMilestoneId("does-not-exist");
    check("getTiersByMilestoneId(unknown) returns []", none.length === 0);

    // 3. createMilestoneTier adds and persists
    const draft: Omit<MilestoneTier, "id"> = {
      milestone_id: "ms-millennia-q",
      tier_threshold_amount: 200000,
      reward_value: 4000,
      reward_unit: "points",
      is_cumulative_payout: false,
      unlocks_in_cycle: "same",
      current_progress_amount: 8190,
      achieved: false,
      achieved_date: null,
      manual_override_achieved: null,
    };
    const created = await createMilestoneTier(draft);
    check(
      "createMilestoneTier() returns a tier with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check(
      "createMilestoneTier() preserves passed fields",
      created.tier_threshold_amount === 200000 && created.reward_value === 4000,
    );

    const afterCreate = await getMilestoneTiers();
    check("createMilestoneTier() persists (now 7)", afterCreate.length === 7);

    // 4. updateMilestoneTier modifies and persists, keeps id immutable
    const updated = await updateMilestoneTier(created.id, {
      achieved: true,
      achieved_date: "2026-06-21",
    });
    check("updateMilestoneTier() returns updated row", updated?.achieved === true);
    check(
      "updateMilestoneTier() applied multi-field update",
      updated?.achieved_date === "2026-06-21",
    );
    check("updateMilestoneTier() keeps id immutable", updated?.id === created.id);

    const reread = (await getMilestoneTiers()).find((t) => t.id === created.id);
    check("updateMilestoneTier() change is persisted", reread?.achieved === true);

    const updateMissing = await updateMilestoneTier("does-not-exist", {
      achieved: true,
    });
    check("updateMilestoneTier(invalid id) returns null", updateMissing === null);
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
