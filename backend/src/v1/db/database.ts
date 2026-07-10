import pg, { type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import type { V1Config } from "../config.js";
import { runMigrations } from "./migrations.js";

const { Pool } = pg;

export class V1Database {
  readonly pool: pg.Pool;

  constructor(config: Pick<V1Config, "DATABASE_URL" | "DATABASE_POOL_MAX">) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,
      application_name: "mia-v1",
      statement_timeout: 30_000,
      query_timeout: 35_000
    });
  }

  async connect(): Promise<void> {
    await runMigrations(this.pool);
  }

  query<R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
