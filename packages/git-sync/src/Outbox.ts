import Database from 'better-sqlite3'

export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'conflict'

export interface OutboxRow {
  id: number
  workspaceId: string
  commitSha: string
  status: OutboxStatus
  retryCount: number
  createdAt: string
}

interface OutboxTableRow {
  id: number
  workspace_id: string
  commit_sha: string
  status: OutboxStatus
  retry_count: number
  created_at: string
}

function toOutboxRow(row: OutboxTableRow): OutboxRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    commitSha: row.commit_sha,
    status: row.status,
    retryCount: row.retry_count,
    createdAt: row.created_at
  }
}

// Nothing the student does ever blocks on a network call (doc §5.4) — every
// local commit is queued here immediately, and draining happens separately
// whenever connectivity allows.
export class Outbox {
  private readonly db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS outbox_commits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
  }

  enqueue(workspaceId: string, commitSha: string): void {
    this.db.prepare('INSERT INTO outbox_commits (workspace_id, commit_sha) VALUES (?, ?)').run(workspaceId, commitSha)
  }

  pending(): OutboxRow[] {
    const rows = this.db.prepare("SELECT * FROM outbox_commits WHERE status = 'pending' ORDER BY id ASC").all() as OutboxTableRow[]
    return rows.map(toOutboxRow)
  }

  markStatus(id: number, status: OutboxStatus): void {
    this.db.prepare('UPDATE outbox_commits SET status = ? WHERE id = ?').run(status, id)
  }

  incrementRetry(id: number): void {
    this.db.prepare('UPDATE outbox_commits SET retry_count = retry_count + 1 WHERE id = ?').run(id)
  }

  close(): void {
    this.db.close()
  }
}
