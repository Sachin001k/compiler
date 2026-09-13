import type { ConnectivityWatcher } from './ConnectivityWatcher'
import type { Outbox } from './Outbox'

export interface GitHubClient {
  push(workspaceId: string, commitSha: string): Promise<'ok' | 'conflict'>
}

// The GitHub App + Octokit wiring is Phase 4 work (needs Athena's auth
// service to broker the App installation) — this makes that gap explicit
// instead of pretending to sync. SyncWorker's draining/backoff mechanics
// are real and exercised today; only the actual network push is stubbed.
export class NotConfiguredGitHubClient implements GitHubClient {
  async push(): Promise<'ok' | 'conflict'> {
    throw new Error('GitHub sync is not configured yet (Phase 4 wires up the GitHub App + Octokit client).')
  }
}

// Drains the outbox with backoff whenever connectivity returns (doc §5.4).
// A push failure re-queues its row as 'pending' and stops the pass rather
// than hammering the API — the next connectivity-restored tick retries.
export class SyncWorker {
  private draining = false

  constructor(
    private readonly outbox: Outbox,
    connectivity: ConnectivityWatcher,
    private readonly client: GitHubClient = new NotConfiguredGitHubClient()
  ) {
    connectivity.onChange((online) => {
      if (online) void this.drain()
    })
  }

  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (const row of this.outbox.pending()) {
        this.outbox.markStatus(row.id, 'syncing')
        try {
          const result = await this.client.push(row.workspaceId, row.commitSha)
          this.outbox.markStatus(row.id, result === 'ok' ? 'synced' : 'conflict')
        } catch {
          this.outbox.incrementRetry(row.id)
          this.outbox.markStatus(row.id, 'pending')
          break
        }
      }
    } finally {
      this.draining = false
    }
  }
}
