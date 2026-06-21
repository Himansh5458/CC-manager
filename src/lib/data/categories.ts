// categories.ts — data-access functions for the Category tab.
//
// All reads/writes go through readDatabase()/writeDatabase() in fileStore.ts.
// This module NEVER touches the database file path directly (see src/lib/CLAUDE.md rule 1).
//
// NOTE: Category has no `id` field — its identity IS its `name`. addCategory is
// therefore idempotent: it will not create a duplicate when a category with the
// same name (case-insensitive) already exists; it returns the existing row instead.

import { readDatabase, writeDatabase } from "./fileStore";
import type { Category } from "../types/schema";

/** Return all categories. */
export async function getCategories(): Promise<Category[]> {
  const db = await readDatabase();
  return db.categories;
}

/**
 * Add a category by name. If a category with the same name already exists
 * (case-insensitive comparison), no duplicate is created and the existing row is
 * returned. Otherwise the new category is persisted and returned.
 */
export async function addCategory(name: string): Promise<Category> {
  const db = await readDatabase();
  const existing = db.categories.find(
    (c) => c.name.toLowerCase() === name.toLowerCase(),
  );
  if (existing) return existing;
  const created: Category = { name };
  db.categories.push(created);
  await writeDatabase(db);
  return created;
}
