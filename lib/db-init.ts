import { getD1 } from "@/db";

let initialization: Promise<unknown> | null = null;

export async function ensureDatabase() {
  const d1 = await getD1();
  if (!initialization) {
    initialization = d1.batch([
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT DEFAULT 'member' NOT NULL,
          discipline TEXT DEFAULT '' NOT NULL,
          password_hash TEXT DEFAULT '' NOT NULL,
          password_salt TEXT DEFAULT '' NOT NULL,
          active INTEGER DEFAULT 1 NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          task_date TEXT NOT NULL,
          employee_name TEXT NOT NULL,
          employee_email TEXT DEFAULT '' NOT NULL,
          project TEXT NOT NULL,
          title TEXT NOT NULL,
          expected_output TEXT DEFAULT '' NOT NULL,
          priority TEXT DEFAULT 'medium' NOT NULL,
          planned_hours REAL DEFAULT 0 NOT NULL,
          start_time TEXT DEFAULT '' NOT NULL,
          end_time TEXT DEFAULT '' NOT NULL,
          actual_hours REAL DEFAULT 0 NOT NULL,
          status TEXT DEFAULT 'not_started' NOT NULL,
          manager_check TEXT DEFAULT 'pending' NOT NULL,
          manager_note TEXT DEFAULT '' NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          code TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          client TEXT DEFAULT '' NOT NULL,
          status TEXT DEFAULT 'active' NOT NULL,
          start_date TEXT DEFAULT '' NOT NULL,
          target_date TEXT DEFAULT '' NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS task_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          task_id INTEGER NOT NULL,
          author_email TEXT NOT NULL,
          author_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks (task_date)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS tasks_employee_idx ON tasks (employee_email)",
      ),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS projects_code_idx ON projects (code)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS sessions_email_idx ON sessions (email)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments (task_id)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS task_comments_created_idx ON task_comments (created_at)",
      ),
    ]).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
