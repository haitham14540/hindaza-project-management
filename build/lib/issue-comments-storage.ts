import { getD1 } from "@/db";

let storageReady: Promise<void> | null = null;

export async function ensureIssueCommentsStorage() {
  if (!storageReady) {
    storageReady = (async () => {
      const d1 = await getD1();
      const existing = await d1.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'issue_comments' LIMIT 1",
      ).first<{ name: string }>();

      if (existing?.name) return;

      await d1.batch([
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
        d1.prepare("CREATE INDEX IF NOT EXISTS issue_comments_issue_idx ON issue_comments (issue_id)"),
        d1.prepare("CREATE INDEX IF NOT EXISTS issue_comments_created_idx ON issue_comments (created_at)"),
        d1.prepare(`
          INSERT INTO issue_comments (issue_id, section, author_email, author_name, body, created_at)
          SELECT issue.id, 'internal', issue.raised_by_email, issue.raised_by_name, issue.comments, issue.updated_at
          FROM project_issues AS issue
          WHERE trim(issue.comments) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM issue_comments AS note
              WHERE note.issue_id = issue.id AND note.section = 'internal' AND note.body = issue.comments
            )
        `),
        d1.prepare(`
          INSERT INTO issue_comments (issue_id, section, author_email, author_name, body, created_at)
          SELECT issue.id, 'client', issue.raised_by_email, issue.raised_by_name, issue.client_reply, issue.updated_at
          FROM project_issues AS issue
          WHERE trim(issue.client_reply) <> ''
            AND NOT EXISTS (
              SELECT 1 FROM issue_comments AS note
              WHERE note.issue_id = issue.id AND note.section = 'client' AND note.body = issue.client_reply
            )
        `),
      ]);
    })().catch((error: unknown) => {
      storageReady = null;
      throw error;
    });
  }

  await storageReady;
}
