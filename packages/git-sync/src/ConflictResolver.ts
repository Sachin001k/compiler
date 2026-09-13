import { runGit } from './git'

export type ConflictOutcome = 'rebased' | 'conflict-branched'

// Rebases first; only branches off on a real conflict, and never touches
// the student's working tree while doing it (doc §5.4). Since each repo
// has exactly one writer 99% of the time, this only has real work to do
// when a teacher pushes feedback into the same repo via a PR comment.
export class ConflictResolver {
  constructor(private readonly cwd: string) {}

  async resolve(): Promise<ConflictOutcome> {
    const rebase = await runGit(['pull', '--rebase'], this.cwd)
    if (rebase.code === 0) return 'rebased'

    await runGit(['rebase', '--abort'], this.cwd)
    const branchName = `local-conflict-${Date.now()}`
    await runGit(['branch', branchName], this.cwd)
    return 'conflict-branched'
  }
}
