import { spawn, type ChildProcess } from 'node:child_process'
import type { ExecOptions } from '@practice-ide/shared-types'

export interface SpawnTarget {
  command: string
  args: string[]
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

// Best-effort OS resource limits around a spawn — one call site so runners
// stay platform-agnostic (doc §5.3). The watchdog's timeout + output cap
// (see watchdog.ts) are what actually bound worst-case damage; this is
// defense-in-depth on top of that, and it is NOT uniformly enforced yet:
//
//   - Linux: `ulimit -v` (address space) is enforced properly by the kernel.
//   - macOS: RLIMIT_AS enforcement is weak/inconsistent — this still sets it,
//     but don't rely on it alone. (Doc §10's own next-step: validate this on
//     a real machine before trusting it.)
//   - Windows: not implemented yet — needs a Job Object, which needs a native
//     addon. Falls back to an unconstrained spawn; timeout/output cap still apply.
export function spawnSandboxed(target: SpawnTarget, options: ExecOptions): ChildProcess {
  const cwd = options.workingDir

  if (process.platform === 'win32') {
    return spawn(target.command, target.args, { cwd })
  }

  const memoryLimitKb = options.memoryLimitMb * 1024
  const quoted = [target.command, ...target.args].map(shellQuote).join(' ')
  const shellCommand = `ulimit -v ${memoryLimitKb}; exec ${quoted}`

  return spawn('/bin/sh', ['-c', shellCommand], { cwd })
}
