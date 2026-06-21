// exclusions.ts — data-access functions for the Exclusion tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { Exclusion } from "../types/schema";

/** Return all exclusions. */
export async function getExclusions(): Promise<Exclusion[]> {
  const db = await readDatabase();
  return db.exclusions;
}

/** Return all exclusions for a given card; [] if none. */
export async function getExclusionsByCardId(cardId: string): Promise<Exclusion[]> {
  const db = await readDatabase();
  return db.exclusions.filter((e) => e.card_id === cardId);
}

/** Create a new exclusion with a generated id, persist it, and return the created row. */
export async function createExclusion(
  e: Omit<Exclusion, "id">,
): Promise<Exclusion> {
  const db = await readDatabase();
  const created: Exclusion = { id: randomUUID(), ...e };
  db.exclusions.push(created);
  await writeDatabase(db);
  return created;
}

/** Remove the exclusion with the given id, persist; true if deleted, false if not found. */
export async function deleteExclusion(id: string): Promise<boolean> {
  const db = await readDatabase();
  const index = db.exclusions.findIndex((e) => e.id === id);
  if (index === -1) return false;
  db.exclusions.splice(index, 1);
  await writeDatabase(db);
  return true;
}
