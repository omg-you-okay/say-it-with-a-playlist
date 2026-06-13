// Apply the plain-SQL migrations in db/init/ (in alphabetical order) against
// DATABASE_URL. Locally the Postgres container runs these automatically via
// docker-entrypoint-initdb.d (see ADR 0005); this script is for environments
// where that entrypoint can't be used — notably the CI Postgres service, which
// starts before the repo is checked out and so can't mount db/init.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";

const dir = path.resolve("db/init");
const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    process.stdout.write(`applying ${file}\n`);
    await pool.query(sql);
  }
} finally {
  await pool.end();
}
