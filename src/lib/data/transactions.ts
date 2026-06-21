// transactions.ts — data-access functions for the Transaction tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { Transaction } from "../types/schema";

/** Return all transactions. */
export async function getTransactions(): Promise<Transaction[]> {
  const db = await readDatabase();
  return db.transactions;
}

/** Return all transactions belonging to the given card id (empty array if none). */
export async function getTransactionsByCardId(
  cardId: string,
): Promise<Transaction[]> {
  const db = await readDatabase();
  return db.transactions.filter((t) => t.card_id === cardId);
}

/** Create a new transaction with a generated id, persist it, and return the created transaction. */
export async function createTransaction(
  txn: Omit<Transaction, "id">,
): Promise<Transaction> {
  const db = await readDatabase();
  const newTxn: Transaction = { id: randomUUID(), ...txn };
  db.transactions.push(newTxn);
  await writeDatabase(db);
  return newTxn;
}

/**
 * Apply a partial update to the transaction with the given id, persist it, and
 * return the updated transaction. Returns null if no transaction has that id.
 * The id is immutable and cannot be changed via updates.
 */
export async function updateTransaction(
  id: string,
  updates: Partial<Transaction>,
): Promise<Transaction | null> {
  const db = await readDatabase();
  const index = db.transactions.findIndex((t) => t.id === id);
  if (index === -1) return null;
  const updated: Transaction = {
    ...db.transactions[index],
    ...updates,
    id: db.transactions[index].id,
  };
  db.transactions[index] = updated;
  await writeDatabase(db);
  return updated;
}

/** Delete the transaction with the given id. Returns true if deleted, false if the id was not found. */
export async function deleteTransaction(id: string): Promise<boolean> {
  const db = await readDatabase();
  const index = db.transactions.findIndex((t) => t.id === id);
  if (index === -1) return false;
  db.transactions.splice(index, 1);
  await writeDatabase(db);
  return true;
}
