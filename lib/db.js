import pg from "pg";

let pool;

export function database() {
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is required");
  pool ??= new pg.Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: process.env.POSTGRES_URL.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false }
  });
  return pool;
}

export async function withTransaction(work) {
  const client = await database().connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function addEvent(client, reportId, status, detail = null) {
  await client.query(
    "insert into fixloop.events (report_id, status, detail) values ($1, $2, $3)",
    [reportId, status, detail]
  );
}
