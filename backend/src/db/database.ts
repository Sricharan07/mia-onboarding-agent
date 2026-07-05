import Database from "better-sqlite3";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import type { AppConfig } from "../config/env.js";
import { runMigrations } from "./migrations.js";

export type Db = Database.Database;

export function createDatabase(config: AppConfig): Db {
  const dbPath = resolveDatabasePath(config.DATABASE_URL);
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}

function resolveDatabasePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return resolve(process.cwd(), databaseUrl.slice("file:".length));
  }

  return resolve(process.cwd(), databaseUrl);
}
