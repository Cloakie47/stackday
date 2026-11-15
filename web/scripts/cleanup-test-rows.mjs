// Removes rows written by scripts/test-account-api.sh for the given throwaway wallets.
//   node --env-file=.env.local scripts/cleanup-test-rows.mjs 0xabc... 0xdef...
import pg from "pg";

const wallets = process.argv.slice(2).map((w) => w.toLowerCase());
const url = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
if (!url || wallets.length === 0) {
  console.error("Usage: node --env-file=.env.local scripts/cleanup-test-rows.mjs <wallet> [wallet...]");
  process.exit(1);
}
const client = new pg.Client({ connectionString: url.replace(/([?&])sslmode=[^&]*&?/, "$1"), ssl: { rejectUnauthorized: false } });
await client.connect();
let removed = 0;
for (const [table, column] of [
  ["attendance", "employee_wallet"],
  ["employees", "employer_wallet"],
  ["employees", "employee_wallet"],
  ["profiles", "wallet"],
]) {
  const r = await client.query(`delete from ${table} where ${column} = any($1)`, [wallets]);
  removed += r.rowCount ?? 0;
}
const { rows } = await client.query(
  "select (select count(*) from profiles) as profiles, (select count(*) from employees) as employees, (select count(*) from attendance) as attendance",
);
console.log(`removed ${removed} test rows. Rows now: profiles ${rows[0].profiles}, employees ${rows[0].employees}, attendance ${rows[0].attendance}`);
await client.end();
