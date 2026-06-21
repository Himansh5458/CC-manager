// rewardRules.ts — data-access functions for the RewardRule tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { RewardRule } from "../types/schema";

/** Return all reward rules. */
export async function getRewardRules(): Promise<RewardRule[]> {
  const db = await readDatabase();
  return db.rewardRules;
}

/** Return all reward rules for a given card; [] if none. */
export async function getRewardRulesByCardId(cardId: string): Promise<RewardRule[]> {
  const db = await readDatabase();
  return db.rewardRules.filter((r) => r.card_id === cardId);
}

/** Create a new reward rule with a generated id, persist it, and return the created row. */
export async function createRewardRule(
  r: Omit<RewardRule, "id">,
): Promise<RewardRule> {
  const db = await readDatabase();
  const created: RewardRule = { id: randomUUID(), ...r };
  db.rewardRules.push(created);
  await writeDatabase(db);
  return created;
}

/**
 * Apply a partial update to the reward rule with the given id, persist it, and
 * return the updated row. Returns null if no row has that id. The id is immutable.
 */
export async function updateRewardRule(
  id: string,
  updates: Partial<RewardRule>,
): Promise<RewardRule | null> {
  const db = await readDatabase();
  const index = db.rewardRules.findIndex((r) => r.id === id);
  if (index === -1) return null;
  const updated: RewardRule = {
    ...db.rewardRules[index],
    ...updates,
    id: db.rewardRules[index].id,
  };
  db.rewardRules[index] = updated;
  await writeDatabase(db);
  return updated;
}

/** Remove the reward rule with the given id, persist; true if deleted, false if not found. */
export async function deleteRewardRule(id: string): Promise<boolean> {
  const db = await readDatabase();
  const index = db.rewardRules.findIndex((r) => r.id === id);
  if (index === -1) return false;
  db.rewardRules.splice(index, 1);
  await writeDatabase(db);
  return true;
}
