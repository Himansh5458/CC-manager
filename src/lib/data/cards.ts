// cards.ts — data-access functions for the Card tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).

import { randomUUID } from "node:crypto";
import { readDatabase, writeDatabase } from "./fileStore";
import type { Card } from "../types/schema";

/** Return all cards. */
export async function getCards(): Promise<Card[]> {
  const db = await readDatabase();
  return db.cards;
}

/** Return a single card by id, or null if no card has that id. */
export async function getCardById(id: string): Promise<Card | null> {
  const db = await readDatabase();
  return db.cards.find((c) => c.id === id) ?? null;
}

/** Create a new card with a generated id, persist it, and return the created card. */
export async function createCard(card: Omit<Card, "id">): Promise<Card> {
  const db = await readDatabase();
  const newCard: Card = { id: randomUUID(), ...card };
  db.cards.push(newCard);
  await writeDatabase(db);
  return newCard;
}

/**
 * Apply a partial update to the card with the given id, persist it, and return
 * the updated card. Returns null if no card has that id. The id is immutable and
 * cannot be changed via updates.
 */
export async function updateCard(
  id: string,
  updates: Partial<Card>,
): Promise<Card | null> {
  const db = await readDatabase();
  const index = db.cards.findIndex((c) => c.id === id);
  if (index === -1) return null;
  const updated: Card = { ...db.cards[index], ...updates, id: db.cards[index].id };
  db.cards[index] = updated;
  await writeDatabase(db);
  return updated;
}
