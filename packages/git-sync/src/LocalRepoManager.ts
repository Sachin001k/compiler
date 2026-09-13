import { runGit } from './git'

// The local repo is the source of truth (doc §5.4) — this never talks to
// the network, it only ever commits to the workspace's own .git.
export class LocalRepoManager {
  constructor(private readonly cwd: string) {}

  async ensureRepo(): Promise<void> {
    const isRepo = await runGit(['rev-parse', '--is-inside-work-tree'], this.cwd)
    if (isRepo.code !== 0) {
      await runGit(['init'], this.cwd)
    }
  }

  // Auto-commit per attempt, per the "Attempt #n — runs, exit <code>" format
  // documented in CLAUDE.md (the teacher-facing replay view depends on it).
  // Returns the new commit SHA, or null when there was nothing to commit
  // (identical to the last attempt — not an error).
  async commitAttempt(attemptNumber: number, exitCode: number | null): Promise<string | null> {
    await this.ensureRepo()
    await runGit(['add', '.'], this.cwd)

    const message = `Attempt #${attemptNumber} — runs, exit ${exitCode ?? 'unknown'}`
    const commit = await runGit(['commit', '-m', message], this.cwd)
    if (commit.code !== 0) {
      return null
    }

    const rev = await runGit(['rev-parse', 'HEAD'], this.cwd)
    return rev.code === 0 ? rev.stdout.trim() : null
  }

  async attemptCount(): Promise<number> {
    const log = await runGit(['rev-list', '--count', 'HEAD'], this.cwd)
    return log.code === 0 ? parseInt(log.stdout.trim(), 10) || 0 : 0
  }
}
