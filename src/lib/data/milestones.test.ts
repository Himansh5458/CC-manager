// Standalone smoke test for the Milestones data-access layer.
//
// Run with: npx tsx src/lib/data/milestones.test.ts
//
// NOTE: create/update mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block, so the committed seed data
// is left untouched (still exactly 2 milestones) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getMilestones,
  getMilestonesByCardId,
  getActiveMilestones,
  createMilestone,
  updateMilestone,
} from "./milestones";
import type { Milestone } from "../types/schema";

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
    // 1. getMilestones returns the 2 seed milestones
    const all = await getMilestones();
    check("getMilestones() returns 2 milestones", all.length === 2);

    // 2. getMilestonesByCardId filters correctly
    const millennia = await getMilestonesByCardId("card-millennia-001");
    check(
      "getMilestonesByCardId(millennia) returns 1",
      millennia.length === 1 && millennia[0].id === "ms-millennia-q",
    );
    const none = await getMilestonesByCardId("does-not-exist");
    check("getMilestonesByCardId(unknown) returns []", none.length === 0);

    // 3. getActiveMilestones returns only active === true (both seed rows active)
    const active = await getActiveMilestones();
    check("getActiveMilestones() returns 2 active", active.length === 2);

    // 4. createMilestone adds and persists
    const draft: Omit<Milestone, "id"> = {
      card_id: "card-millennia-001",
      track_name: "Test Bonus",
      cycle_frequency: "monthly",
      cycle_anchor: "calendar",
      anchor_reference_date: null,
      tier_type: "highest_only",
      earning_window_offset: 0,
      cycle_start_date: "2026-06-01",
      cycle_end_date: "2026-06-30",
      active: false,
    };
    const created = await createMilestone(draft);
    check(
      "createMilestone() returns a milestone with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check(
      "createMilestone() preserves passed fields",
      created.track_name === "Test Bonus" && created.active === false,
    );

    const afterCreate = await getMilestones();
    check("createMilestone() persists (now 3)", afterCreate.length === 3);

    // getActiveMilestones still 2 (the new one is inactive)
    const activeAfterCreate = await getActiveMilestones();
    check(
      "getActiveMilestones() excludes the inactive new row (still 2)",
      activeAfterCreate.length === 2,
    );

    // 5. updateMilestone modifies and persists, keeps id immutable
    const updated = await updateMilestone(created.id, { active: true });
    check("updateMilestone() returns updated row", updated?.active === true);
    check("updateMilestone() keeps id immutable", updated?.id === created.id);

    const reread = (await getMilestones()).find((m) => m.id === created.id);
    check("updateMilestone() change is persisted", reread?.active === true);

    const updateMissing = await updateMilestone("does-not-exist", {
      active: false,
    });
    check("updateMilestone(invalid id) returns null", updateMissing === null);
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
