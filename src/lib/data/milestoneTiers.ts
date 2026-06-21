// milestoneTiers.ts — data-access functions for the MilestoneTier tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { MilestoneTier } from "../types/schema";

/** Return all milestone tiers. */
export async function getMilestoneTiers(): Promise<MilestoneTier[]> {
  const db = await readDatabase();
  return db.milestoneTiers;
}

/** Return all tiers belonging to the given milestone id (empty array if none). */
export async function getTiersByMilestoneId(
  milestoneId: string,
): Promise<MilestoneTier[]> {
  const db = await readDatabase();
  return db.milestoneTiers.filter((t) => t.milestone_id === milestoneId);
}

/** Create a new milestone tier with a generated id, persist it, and return the created tier. */
export async function createMilestoneTier(
  t: Omit<MilestoneTier, "id">,
): Promise<MilestoneTier> {
  const db = await readDatabase();
  const newTier: MilestoneTier = { id: randomUUID(), ...t };
  db.milestoneTiers.push(newTier);
  await writeDatabase(db);
  return newTier;
}

/**
 * Apply a partial update to the milestone tier with the given id, persist it, and
 * return the updated tier. Returns null if no tier has that id. The id is
 * immutable and cannot be changed via updates.
 */
export async function updateMilestoneTier(
  id: string,
  updates: Partial<MilestoneTier>,
): Promise<MilestoneTier | null> {
  const db = await readDatabase();
  const index = db.milestoneTiers.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const updated: MilestoneTier = {
    ...db.milestoneTiers[index],
    ...updates,
    id: db.milestoneTiers[index].id,
  };
  db.milestoneTiers[index] = updated;
  await writeDatabase(db);
  return updated;
}
