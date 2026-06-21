// recurringTransactions.ts — data-access functions for the RecurringTransaction tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { RecurringTransaction } from "../types/schema";

/** Return all recurring transactions. */
export async function getRecurringTransactions(): Promise<
  RecurringTransaction[]
> {
  const db = await readDatabase();
  return db.recurringTransactions;
}

/**
 * Return only recurring transactions that are currently in effect: `active === true`
 * AND (`end_date` is null/indefinite OR `end_date` is today or later).
 *
 * Dates are ISO 8601 (YYYY-MM-DD), so a lexicographic string comparison against
 * today's date is correct and sidesteps timezone parsing. A recurring transaction
 * is treated as still active up to and including its end_date.
 */
export async function getActiveRecurringTransactions(): Promise<
  RecurringTransaction[]
> {
  const db = await readDatabase();
  const today = new Date().toISOString().slice(0, 10);
  return db.recurringTransactions.filter(
    (rt) => rt.active && (rt.end_date === null || rt.end_date >= today),
  );
}

/** Create a new recurring transaction with a generated id, persist it, and return it. */
export async function createRecurringTransaction(
  rt: Omit<RecurringTransaction, "id">,
): Promise<RecurringTransaction> {
  const db = await readDatabase();
  const newRt: RecurringTransaction = { id: randomUUID(), ...rt };
  db.recurringTransactions.push(newRt);
  await writeDatabase(db);
  return newRt;
}

/**
 * Apply a partial update to the recurring transaction with the given id, persist
 * it, and return the updated row. Returns null if no row has that id. The id is
 * immutable and cannot be changed via updates.
 */
export async function updateRecurringTransaction(
  id: string,
  updates: Partial<RecurringTransaction>,
): Promise<RecurringTransaction | null> {
  const db = await readDatabase();
  const index = db.recurringTransactions.findIndex((rt) => rt.id === id);
  if (index === -1) return null;
  const updated: RecurringTransaction = {
    ...db.recurringTransactions[index],
    ...updates,
    id: db.recurringTransactions[index].id,
  };
  db.recurringTransactions[index] = updated;
  await writeDatabase(db);
  return updated;
}
