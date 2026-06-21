// familyCapTracker.ts — data-access functions for the FamilyCapTracker tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).
//
// STRUCTURAL NOTE: unlike every other tab, FamilyCapTracker has NO single `id`
// field. Its primary key is the COMPOSITE of (family_key + financial_year) — see
// src/lib/types/schema.ts. There is therefore no randomUUID() here and no separate
// create/update pair; instead a single upsert keys on that pair: it updates the
// existing row when one matches, otherwise inserts a new one.

import { readDatabase, writeDatabase } from "./fileStore";
import type { FamilyCapTracker } from "../types/schema";

/** Return all family-cap tracker rows. */
export async function getFamilyCapTrackers(): Promise<FamilyCapTracker[]> {
  const db = await readDatabase();
  return db.familyCapTracker;
}

/**
 * Return the single row matching the (family_key, financial_year) composite key,
 * or null if none exists.
 */
export async function getFamilyCapTracker(
  familyKey: string,
  financialYear: string,
): Promise<FamilyCapTracker | null> {
  const db = await readDatabase();
  return (
    db.familyCapTracker.find(
      (t) => t.family_key === familyKey && t.financial_year === financialYear,
    ) ?? null
  );
}

/**
 * Upsert by composite key (family_key + financial_year): if a row with the same
 * pair already exists it is replaced in place (no duplicate created); otherwise the
 * entry is appended. Persists and returns the stored entry.
 */
export async function upsertFamilyCapTracker(
  entry: FamilyCapTracker,
): Promise<FamilyCapTracker> {
  const db = await readDatabase();
  const index = db.familyCapTracker.findIndex(
    (t) =>
      t.family_key === entry.family_key &&
      t.financial_year === entry.financial_year,
  );
  if (index === -1) {
    db.familyCapTracker.push(entry);
  } else {
    db.familyCapTracker[index] = entry;
  }
  await writeDatabase(db);
  return entry;
}
