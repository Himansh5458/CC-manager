// Standalone smoke test for the Cards data-access layer.
//
// Run with: npx tsx src/lib/data/cards.test.ts
//
// NOTE: createCard()/updateCard() mutate /data/database.json. This script snapshots
// the file before running and restores it in a finally block, so the committed seed
// data is left untouched (still exactly 2 cards) regardless of pass/fail.

import { promises as fs } from "node:fs";
import path from "node:path";
import { getCards, getCardById, createCard, updateCard } from "./cards";
import type { Card } from "../types/schema";

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

async function main(): Promise<void> {
  const backup = await fs.readFile(DB_PATH, "utf-8");

  try {
    // 1. getCards returns the 2 seed cards
    const cards = await getCards();
    check("getCards() returns 2 cards", cards.length === 2);

    // 2. getCardById for a valid id
    const millennia = await getCardById("card-millennia-001");
    check("getCardById(valid) returns the right card", millennia?.card_name === "HDFC Millennia");

    // 3. getCardById for an invalid id
    const missing = await getCardById("does-not-exist");
    check("getCardById(invalid) returns null", missing === null);

    // 4. createCard adds a card and persists it
    const draft: Omit<Card, "id"> = {
      card_holder: "Rohit Singh",
      card_name: "SBI Cashback",
      card_bank: "SBI",
      card_type: "Visa",
      card_number_encrypted: "PLACEHOLDER_NOT_ENCRYPTED",
      card_number_last4: "9090",
      expiry_month: 1,
      expiry_year: 2030,
      registered_phone: "+91-9876500001",
      registered_email: "rohit.singh@example.com",
      annual_fee: 999,
      statement_date: 10,
      payment_deadline_days: 18,
      customer_care_number: "1860-180-1290",
      credit_limit: 100000,
      renewal_date: "2027-01-10",
      issuance_date: "2026-01-10",
      benefits_summary: "5% cashback online, 1% offline.",
      parent_family: "SBI Rohit Singh",
      current_outstanding_balance: 0,
      current_utilization_pct: 0,
      manual_override_utilization_pct: null,
      active: true,
    };
    const created = await createCard(draft);
    check("createCard() returns a card with a generated id", typeof created.id === "string" && created.id.length > 0);
    check("createCard() preserves passed fields", created.card_name === "SBI Cashback");

    const afterCreate = await getCards();
    check("createCard() persists (now 3 cards)", afterCreate.length === 3);

    const refetched = await getCardById(created.id);
    check("createCard() persisted card is retrievable by id", refetched?.card_name === "SBI Cashback");

    // 5. updateCard modifies a field correctly and persists
    const updated = await updateCard(created.id, { credit_limit: 250000 });
    check("updateCard() returns updated card with new value", updated?.credit_limit === 250000);

    const reread = await getCardById(created.id);
    check("updateCard() change is persisted", reread?.credit_limit === 250000);

    check("updateCard() does not change the id", updated?.id === created.id);

    const updateMissing = await updateCard("does-not-exist", { credit_limit: 1 });
    check("updateCard(invalid id) returns null", updateMissing === null);
  } finally {
    // Restore the seed file so committed data is unchanged.
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
