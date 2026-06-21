// cardTermsHistory.ts — data-access functions for the CardTermsHistory tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { CardTermsHistoryEntry } from "../types/schema";

/** Return all card-terms-history entries. */
export async function getCardTermsHistory(): Promise<CardTermsHistoryEntry[]> {
  const db = await readDatabase();
  return db.cardTermsHistory;
}

/** Return all terms-history entries for a given card; [] if none. */
export async function getTermsHistoryByCardId(
  cardId: string,
): Promise<CardTermsHistoryEntry[]> {
  const db = await readDatabase();
  return db.cardTermsHistory.filter((e) => e.card_id === cardId);
}

/** Return only entries that are still unconfirmed (confirmed === false). */
export async function getPendingTermsHistory(): Promise<CardTermsHistoryEntry[]> {
  const db = await readDatabase();
  return db.cardTermsHistory.filter((e) => e.confirmed === false);
}

/** Create a new entry with a generated id, persist it, and return the created row. */
export async function createTermsHistoryEntry(
  e: Omit<CardTermsHistoryEntry, "id">,
): Promise<CardTermsHistoryEntry> {
  const db = await readDatabase();
  const created: CardTermsHistoryEntry = { id: randomUUID(), ...e };
  db.cardTermsHistory.push(created);
  await writeDatabase(db);
  return created;
}

/**
 * Mark the entry with the given id as confirmed (confirmed = true), persist it, and
 * return the updated row. Returns null if no entry has that id.
 */
export async function confirmTermsHistoryEntry(
  id: string,
): Promise<CardTermsHistoryEntry | null> {
  const db = await readDatabase();
  const index = db.cardTermsHistory.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated: CardTermsHistoryEntry = {
    ...db.cardTermsHistory[index],
    confirmed: true,
  };
  db.cardTermsHistory[index] = updated;
  await writeDatabase(db);
  return updated;
}
