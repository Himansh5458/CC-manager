// milestones.ts — data-access functions for the Milestone tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { Milestone } from "../types/schema";

/** Return all milestones. */
export async function getMilestones(): Promise<Milestone[]> {
  const db = await readDatabase();
  return db.milestones;
}

/** Return all milestones belonging to the given card id (empty array if none). */
export async function getMilestonesByCardId(
  cardId: string,
): Promise<Milestone[]> {
  const db = await readDatabase();
  return db.milestones.filter((m) => m.card_id === cardId);
}

/** Return only milestones where `active === true`. */
export async function getActiveMilestones(): Promise<Milestone[]> {
  const db = await readDatabase();
  return db.milestones.filter((m) => m.active === true);
}

/** Create a new milestone with a generated id, persist it, and return the created milestone. */
export async function createMilestone(
  m: Omit<Milestone, "id">,
): Promise<Milestone> {
  const db = await readDatabase();
  const newMilestone: Milestone = { id: randomUUID(), ...m };
  db.milestones.push(newMilestone);
  await writeDatabase(db);
  return newMilestone;
}

/**
 * Apply a partial update to the milestone with the given id, persist it, and
 * return the updated milestone. Returns null if no milestone has that id. The id
 * is immutable and cannot be changed via updates.
 */
export async function updateMilestone(
  id: string,
  updates: Partial<Milestone>,
): Promise<Milestone | null> {
  const db = await readDatabase();
  const index = db.milestones.findIndex((m) => m.id === id);
  if (index === -1) return null;
  const updated: Milestone = {
    ...db.milestones[index],
    ...updates,
    id: db.milestones[index].id,
  };
  db.milestones[index] = updated;
  await writeDatabase(db);
  return updated;
}
