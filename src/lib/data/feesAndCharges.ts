// feesAndCharges.ts — data-access functions for the FeeAndCharge tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { FeeAndCharge } from "../types/schema";

/** Return all fees and charges. */
export async function getFeesAndCharges(): Promise<FeeAndCharge[]> {
  const db = await readDatabase();
  return db.feesAndCharges;
}

/** Return all fees and charges for a given card; [] if none. */
export async function getFeesByCardId(cardId: string): Promise<FeeAndCharge[]> {
  const db = await readDatabase();
  return db.feesAndCharges.filter((f) => f.card_id === cardId);
}

/** Create a new fee/charge with a generated id, persist it, and return the created row. */
export async function createFeeAndCharge(
  f: Omit<FeeAndCharge, "id">,
): Promise<FeeAndCharge> {
  const db = await readDatabase();
  const created: FeeAndCharge = { id: randomUUID(), ...f };
  db.feesAndCharges.push(created);
  await writeDatabase(db);
  return created;
}

/**
 * Apply a partial update to the fee/charge with the given id, persist it, and
 * return the updated row. Returns null if no row has that id. The id is immutable.
 */
export async function updateFeeAndCharge(
  id: string,
  updates: Partial<FeeAndCharge>,
): Promise<FeeAndCharge | null> {
  const db = await readDatabase();
  const index = db.feesAndCharges.findIndex((f) => f.id === id);
  if (index === -1) return null;
  const updated: FeeAndCharge = {
    ...db.feesAndCharges[index],
    ...updates,
    id: db.feesAndCharges[index].id,
  };
  db.feesAndCharges[index] = updated;
  await writeDatabase(db);
  return updated;
}

/** Remove the fee/charge with the given id, persist; true if deleted, false if not found. */
export async function deleteFeeAndCharge(id: string): Promise<boolean> {
  const db = await readDatabase();
  const index = db.feesAndCharges.findIndex((f) => f.id === id);
  if (index === -1) return false;
  db.feesAndCharges.splice(index, 1);
  await writeDatabase(db);
  return true;
}
