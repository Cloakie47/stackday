// Creates the Stackday tables in the Supabase database.
// Reads the database address from the environment (never prints it):
//   node --env-file=.env.local scripts/apply-schema.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url) {
  console.error("No database address found. Expected POSTGRES_URL_NON_POOLING or POSTGRES_URL in the environment.");
  process.exit(1);
}
const sql = readFileSync(fileURLToPath(new URL("../../supabase/schema.sql", import.meta.url)), "utf8");
// Strip the sslmode parameter so the explicit ssl option below is the one that applies.
const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1"), ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  await client.query(sql);
  // Every table in the public schema must have row level security on, and the core tables must exist.
  const { rows } = await client.query(
    "select c.relname as table, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1",
  );
  for (const r of rows) console.log(`table ${r.table}: row level security ${r.rls ? "ON" : "OFF"}`);
  const names = new Set(rows.map((r) => r.table));
  const missing = ["profiles", "employees", "attendance", "sign_in_nonces"].filter((t) => !names.has(t));
  if (missing.length || rows.some((r) => !r.rls)) throw new Error(`schema check failed${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
  console.log("Schema applied.");
} catch (e) {
  console.error("Could not apply the schema:", e.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
