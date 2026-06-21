// Standalone smoke test for the RewardRules data-access layer.
//
// Run with: npx tsx src/lib/data/rewardRules.test.ts
//
// NOTE: create/update/delete mutate /data/database.json. This script snapshots the
// file before running and restores it in a finally block, so the committed seed
// data is left untouched regardless of pass/fail. Seed currently holds 6 reward
// rules (3 for card-millennia-001, 3 for card-atlas-001).

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getRewardRules,
  getRewardRulesByCardId,
  createRewardRule,
  updateRewardRule,
  deleteRewardRule,
} from "./rewardRules";
import type { RewardRule } from "../types/schema";

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
    // 1. getRewardRules returns the 6 seed rules.
    const all = await getRewardRules();
    check("getRewardRules() returns 6 seed rules", all.length === 6);

    // 2. getRewardRulesByCardId filters per card.
    const millennia = await getRewardRulesByCardId("card-millennia-001");
    check("getRewardRulesByCardId(millennia) returns 3", millennia.length === 3);
    check(
      "getRewardRulesByCardId(millennia) returns only that card's rules",
      millennia.every((r) => r.card_id === "card-millennia-001"),
    );

    const atlas = await getRewardRulesByCardId("card-atlas-001");
    check("getRewardRulesByCardId(atlas) returns 3", atlas.length === 3);

    const none = await getRewardRulesByCardId("does-not-exist");
    check("getRewardRulesByCardId(unknown) returns []", none.length === 0);

    // 3. createRewardRule adds a rule and persists it.
    const draft: Omit<RewardRule, "id"> = {
      card_id: "card-millennia-001",
      category: "Fuel",
      reward_currency: "cashback",
      multiplier_or_rate: 0.05,
      redemption_value_per_unit: 1,
      monthly_cap: 200,
      cap_unit: "INR",
      source_dump_text: "5% cashback on fuel up to Rs.200/month",
      extracted_date: "2026-06-21",
    };
    const created = await createRewardRule(draft);
    check(
      "createRewardRule() returns a rule with a generated id",
      typeof created.id === "string" && created.id.length > 0,
    );
    check("createRewardRule() preserves passed fields", created.category === "Fuel");

    const afterCreate = await getRewardRules();
    check("createRewardRule() persists (now 7)", afterCreate.length === 7);

    const millenniaAfter = await getRewardRulesByCardId("card-millennia-001");
    check("createRewardRule() persisted row is retrievable by card", millenniaAfter.length === 4);

    // 4. updateRewardRule modifies a field and persists.
    const updated = await updateRewardRule(created.id, { multiplier_or_rate: 0.1 });
    check("updateRewardRule() returns updated row with new value", updated?.multiplier_or_rate === 0.1);
    check("updateRewardRule() keeps id immutable", updated?.id === created.id);

    const updateMissing = await updateRewardRule("does-not-exist", { multiplier_or_rate: 1 });
    check("updateRewardRule(invalid id) returns null", updateMissing === null);

    // 5. deleteRewardRule removes the row and persists.
    const deleted = await deleteRewardRule(created.id);
    check("deleteRewardRule() returns true", deleted === true);

    const afterDelete = await getRewardRules();
    check("deleteRewardRule() persists (back to 6)", afterDelete.length === 6);

    const deleteMissing = await deleteRewardRule("does-not-exist");
    check("deleteRewardRule(invalid id) returns false", deleteMissing === false);
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
