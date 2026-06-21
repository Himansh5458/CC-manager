// payments.ts — data-access functions for the Payment tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).
//
// Payments are intentionally append-or-delete only: there is no update function.
// A payment is either logged correctly or deleted and re-logged — keep it simple.

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { Payment } from "../types/schema";

/** Return all payments. */
export async function getPayments(): Promise<Payment[]> {
  const db = await readDatabase();
  return db.payments;
}

/** Return all payments belonging to the given card id (empty array if none). */
export async function getPaymentsByCardId(cardId: string): Promise<Payment[]> {
  const db = await readDatabase();
  return db.payments.filter((p) => p.card_id === cardId);
}

/** Create a new payment with a generated id, persist it, and return the created payment. */
export async function createPayment(
  payment: Omit<Payment, "id">,
): Promise<Payment> {
  const db = await readDatabase();
  const newPayment: Payment = { id: randomUUID(), ...payment };
  db.payments.push(newPayment);
  await writeDatabase(db);
  return newPayment;
}

/** Delete the payment with the given id. Returns true if deleted, false if the id was not found. */
export async function deletePayment(id: string): Promise<boolean> {
  const db = await readDatabase();
  const index = db.payments.findIndex((p) => p.id === id);
  if (index === -1) return false;
  db.payments.splice(index, 1);
  await writeDatabase(db);
  return true;
}
