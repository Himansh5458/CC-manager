// run-tests.ts — discover and run every *.test.ts suite under src/lib/.
//
// Why this exists: a plain `tsx a && tsx b && ...` chain is fail-fast — the first
// failing suite hides the status of every later one. This runner instead runs ALL
// suites (each in its own `tsx` subprocess), reports each one's pass/fail, prints a
// summary table, and exits non-zero if ANY suite failed. New *.test.ts files are
// auto-discovered — no list to maintain here or in package.json.
//
// Run with: npm test  (or: npx tsx scripts/run-tests.ts)

import { promises as fs } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = process.cwd();
const SEARCH_DIR = path.join(ROOT, "src", "lib");

/** Recursively collect all *.test.ts file paths under dir. */
async function findTestFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTestFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

async function main(): Promise<void> {
  const testFiles = (await findTestFiles(SEARCH_DIR)).sort();

  if (testFiles.length === 0) {
    console.log(`No *.test.ts files found under ${path.relative(ROOT, SEARCH_DIR)}/.`);
    return;
  }

  console.log(`Discovered ${testFiles.length} test suite(s) under src/lib/:\n`);

  const results: { file: string; ok: boolean }[] = [];

  for (const file of testFiles) {
    const rel = path.relative(ROOT, file);
    console.log(`\n=== ${rel} ===`);
    // Each suite sets process.exitCode = 1 on failure; inherit stdio so its
    // own PASS/FAIL lines stream through to the console.
    const result = spawnSync("npx", ["tsx", file], { stdio: "inherit" });
    const ok = result.status === 0;
    results.push({ file: rel, ok });
  }

  // Summary table
  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "=".repeat(60));
  console.log("Test suite summary");
  console.log("=".repeat(60));
  for (const r of results) {
    console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.file}`);
  }
  console.log("-".repeat(60));
  console.log(
    `  ${results.length - failed.length}/${results.length} suites passed` +
      (failed.length > 0 ? `, ${failed.length} failed` : ""),
  );
  console.log("=".repeat(60));

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
