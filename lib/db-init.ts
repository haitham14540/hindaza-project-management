import { getD1 } from "@/db";

let initialization: Promise<unknown> | null = null;

export async function ensureDatabase() {
  // Hosted deployments must apply Drizzle migrations before they begin
  // serving traffic. Running PRAGMA/ALTER statements inside authentication on
  // every cold Worker isolate can block every signed-in request behind a D1
  // schema lock, so production requests never perform schema discovery or
  // mutation here.
  if (process.env.NODE_ENV === "production") return true;

  const d1 = await getD1();
  if (!initialization) {
    initialization = (async () => {
      await d1.batch([
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY NOT NULL,
          display_name TEXT NOT NULL,
          role TEXT DEFAULT 'member' NOT NULL,
          discipline TEXT DEFAULT '' NOT NULL,
          password_hash TEXT DEFAULT '' NOT NULL,
          password_salt TEXT DEFAULT '' NOT NULL,
          profile_image_key TEXT DEFAULT '' NOT NULL,
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
          completion_percent INTEGER DEFAULT 0 NOT NULL,
          completion_before_review INTEGER DEFAULT 0 NOT NULL,
          status TEXT DEFAULT 'not_started' NOT NULL,
          manager_check TEXT DEFAULT 'new' NOT NULL,
          manager_note TEXT DEFAULT '' NOT NULL,
          visibility TEXT DEFAULT 'team' NOT NULL,
          submitted_to_manager INTEGER DEFAULT 0 NOT NULL,
          originated_by_email TEXT DEFAULT '' NOT NULL,
          originated_by_name TEXT DEFAULT '' NOT NULL,
          accepted_by_email TEXT DEFAULT '' NOT NULL,
          accepted_by_name TEXT DEFAULT '' NOT NULL,
          work_cycle INTEGER DEFAULT 1 NOT NULL,
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
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS issue_comments (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          issue_id INTEGER NOT NULL,
          section TEXT DEFAULT 'internal' NOT NULL,
          author_email TEXT NOT NULL,
          author_name TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS task_subtasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          task_id INTEGER NOT NULL,
          title TEXT NOT NULL,
          completed INTEGER DEFAULT 0 NOT NULL,
          completed_at TEXT,
          completed_by TEXT DEFAULT '' NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS task_attachments (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          task_id INTEGER NOT NULL,
          subtask_id INTEGER,
          object_key TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          content_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          uploaded_by TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS project_members (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          project_id INTEGER NOT NULL,
          employee_email TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS notifications (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          recipient_email TEXT NOT NULL,
          type TEXT NOT NULL,
          task_id INTEGER,
          title TEXT NOT NULL,
          message TEXT NOT NULL,
          read INTEGER DEFAULT 0 NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `),
      d1.prepare(`
        CREATE TABLE IF NOT EXISTS task_time_entries (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          task_id INTEGER NOT NULL,
          employee_email TEXT NOT NULL,
          employee_name TEXT DEFAULT '' NOT NULL,
          started_at TEXT NOT NULL,
          resumed_at TEXT,
          ended_at TEXT,
          duration_seconds INTEGER DEFAULT 0 NOT NULL,
          work_cycle INTEGER DEFAULT 1 NOT NULL,
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
      d1.prepare("CREATE INDEX IF NOT EXISTS issue_comments_issue_idx ON issue_comments (issue_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS issue_comments_created_idx ON issue_comments (created_at)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS task_subtasks_task_idx ON task_subtasks (task_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS task_subtasks_completed_idx ON task_subtasks (task_id, completed)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments (task_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS task_attachments_subtask_idx ON task_attachments (subtask_id)"),
      d1.prepare("CREATE INDEX IF NOT EXISTS task_attachments_created_idx ON task_attachments (created_at)"),
      d1.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_employee_idx ON project_members (project_id, employee_email)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS project_members_employee_idx ON project_members (employee_email)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notifications (recipient_email)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notifications_recipient_read_idx ON notifications (recipient_email, read)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS task_time_entries_task_idx ON task_time_entries (task_id)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS task_time_entries_employee_idx ON task_time_entries (employee_email)",
      ),
      d1.prepare(
        "CREATE INDEX IF NOT EXISTS task_time_entries_active_idx ON task_time_entries (employee_email, ended_at)",
      ),
      ]);
      const columns = await d1.prepare("PRAGMA table_info(users)").all<{ name: string }>();
      if (!columns.results.some((column) => column.name === "profile_image_key")) {
        await d1.prepare("ALTER TABLE users ADD COLUMN profile_image_key TEXT DEFAULT '' NOT NULL").run();
      }
      const taskColumns = await d1.prepare("PRAGMA table_info(tasks)").all<{ name: string }>();
      if (!taskColumns.results.some((column) => column.name === "completion_percent")) {
        await d1.prepare("ALTER TABLE tasks ADD COLUMN completion_percent INTEGER DEFAULT 0 NOT NULL").run();
      }
      if (!taskColumns.results.some((column) => column.name === "completion_before_review")) {
        await d1.prepare("ALTER TABLE tasks ADD COLUMN completion_before_review INTEGER DEFAULT 0 NOT NULL").run();
      }
      await d1.prepare(`
        UPDATE users SET role = 'owner'
        WHERE email = (
          SELECT email FROM users WHERE role = 'manager' AND active = 1 ORDER BY created_at, email LIMIT 1
        ) AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'owner')
      `).run();
      return true;
    })().catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
