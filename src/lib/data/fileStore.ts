// fileStore.ts — the ONLY module permitted to touch the database file path.
//
// Hard rule (see /CLAUDE.md "Data Access Layer" and src/lib/CLAUDE.md rule 1):
// NO other file anywhere in the codebase may read or write /data/database.json
// directly. All persistence flows through readDatabase()/writeDatabase() here.
// When the production backend switches from local JSON to Google Sheets, ONLY
// this file changes — every consumer keeps calling the same two functions.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Database } from "../types/schema";

// Resolved relative to the process working directory (project root) so it works
// identically under Next.js (server) and standalone scripts run from the root.
const DB_PATH = path.join(process.cwd(), "data", "database.json");

/** Read and parse the entire database object from disk. */
export async function readDatabase(): Promise<Database> {
  const raw = await fs.readFile(DB_PATH, "utf-8");
  return JSON.parse(raw) as Database;
}

/** Write the entire database object back to disk, pretty-printed (2-space indent). */
export async function writeDatabase(db: Database): Promise<void> {
  const serialized = JSON.stringify(db, null, 2);
  await fs.writeFile(DB_PATH, serialized + "\n", "utf-8");
}
