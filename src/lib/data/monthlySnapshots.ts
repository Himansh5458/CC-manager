// monthlySnapshots.ts — data-access functions for the MonthlySnapshot tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { MonthlySnapshot } from "../types/schema";

/** Return all monthly snapshots. */
export async function getMonthlySnapshots(): Promise<MonthlySnapshot[]> {
  const db = await readDatabase();
  return db.monthlySnapshots;
}

/** Return all snapshots for a given card; [] if none. */
export async function getSnapshotsByCardId(cardId: string): Promise<MonthlySnapshot[]> {
  const db = await readDatabase();
  return db.monthlySnapshots.filter((s) => s.card_id === cardId);
}

/**
 * Return the most recent snapshot for a card, by cycle_end_date (ISO date strings
 * compared lexicographically). Returns null if the card has no snapshots.
 */
export async function getLatestSnapshotForCard(
  cardId: string,
): Promise<MonthlySnapshot | null> {
  const db = await readDatabase();
  const forCard = db.monthlySnapshots.filter((s) => s.card_id === cardId);
  if (forCard.length === 0) return null;
  return forCard.reduce((latest, s) =>
    s.cycle_end_date > latest.cycle_end_date ? s : latest,
  );
}

/** Create a new snapshot with a generated id, persist it, and return the created row. */
export async function createMonthlySnapshot(
  s: Omit<MonthlySnapshot, "id">,
): Promise<MonthlySnapshot> {
  const db = await readDatabase();
  const created: MonthlySnapshot = { id: randomUUID(), ...s };
  db.monthlySnapshots.push(created);
  await writeDatabase(db);
  return created;
}

/**
 * Apply a partial update to the snapshot with the given id, persist it, and return
 * the updated row. Returns null if no row has that id. The id is immutable.
 */
export async function updateMonthlySnapshot(
  id: string,
  updates: Partial<MonthlySnapshot>,
): Promise<MonthlySnapshot | null> {
  const db = await readDatabase();
  const index = db.monthlySnapshots.findIndex((s) => s.id === id);
  if (index === -1) return null;
  const updated: MonthlySnapshot = {
    ...db.monthlySnapshots[index],
    ...updates,
    id: db.monthlySnapshots[index].id,
  };
  db.monthlySnapshots[index] = updated;
  await writeDatabase(db);
  return updated;
}
