// Standalone smoke test for the CardTermsHistory data-access layer.
//
// Run with: npx tsx src/lib/data/cardTermsHistory.test.ts
//
// NOTE: create/confirm mutate /data/database.json. This script snapshots the file
// before running and restores it in a finally block. (Seed has cardTermsHistory
// empty by design.)

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  getCardTermsHistory,
  getTermsHistoryByCardId,
  getPendingTermsHistory,
  createTermsHistoryEntry,
  confirmTermsHistoryEntry,
} from "./cardTermsHistory";
import type { CardTermsHistoryEntry } from "../types/schema";

const DB_PATH = path.join(process.cwd(), "data", "database.json");

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
  }
}

function draft(cardId: string, confirmed: boolean): Omit<CardTermsHistoryEntry, "id"> {
  return {
    card_id: cardId,
    field_changed: "annual_fee",
    old_value: "1000",
    new_value: "1500",
    confidence: "high",
    source_url: "https://example.com/terms",
    detected_date: "2026-06-21",
    confirmed,
    notes: "Detected fee hike",
  };
}

async function main(): Promise<void> {
  const backup = await fs.readFile(DB_PATH, "utf-8");

  try {
    const all = await getCardTermsHistory();
    check("getCardTermsHistory() returns an array", Array.isArray(all));
    const seedCount = all.length;

    // Create one unconfirmed and one already-confirmed entry.
    const pending = await createTermsHistoryEntry(draft("card-millennia-001", false));
    const alreadyConfirmed = await createTermsHistoryEntry(draft("card-atlas-001", true));

    check(
      "createTermsHistoryEntry() returns a row with a generated id",
      typeof pending.id === "string" && pending.id.length > 0,
    );

    const afterCreate = await getCardTermsHistory();
    check("createTermsHistoryEntry() persists (count + 2)", afterCreate.length === seedCount + 2);

    const byCard = await getTermsHistoryByCardId("card-millennia-001");
    check(
      "getTermsHistoryByCardId() returns only that card's entries",
      byCard.every((e) => e.card_id === "card-millennia-001"),
    );

    // getPendingTermsHistory returns only confirmed === false.
    const pendingList = await getPendingTermsHistory();
    check(
      "getPendingTermsHistory() includes the unconfirmed entry",
      pendingList.some((e) => e.id === pending.id),
    );
    check(
      "getPendingTermsHistory() excludes the confirmed entry",
      !pendingList.some((e) => e.id === alreadyConfirmed.id),
    );

    // confirmTermsHistoryEntry flips confirmed to true.
    const confirmed = await confirmTermsHistoryEntry(pending.id);
    check("confirmTermsHistoryEntry() sets confirmed to true", confirmed?.confirmed === true);
    check("confirmTermsHistoryEntry() keeps id immutable", confirmed?.id === pending.id);

    const pendingAfter = await getPendingTermsHistory();
    check(
      "confirmed entry no longer appears in pending list",
      !pendingAfter.some((e) => e.id === pending.id),
    );

    const confirmMissing = await confirmTermsHistoryEntry("does-not-exist");
    check("confirmTermsHistoryEntry(invalid id) returns null", confirmMissing === null);
  } finally {
    await fs.writeFile(DB_PATH, backup, "utf-8");
    console.log("\nRestored data/database.json to its pre-test state.");
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
