import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { CompileResult, ExecOptions, LanguageId } from '@practice-ide/shared-types'
import { BaseRunner } from './BaseRunner'

const ARTIFACT_NAME = 'practice-ide-attempt.out'

export class CppRunner extends BaseRunner {
  readonly id: LanguageId = 'cpp'

  protected probeCommand() {
    return { command: 'g++', args: ['--version'] }
  }

  protected doCompile(filePath: string, options: ExecOptions): Promise<CompileResult> {
    const artifactPath = join(options.workingDir, ARTIFACT_NAME)
    return new Promise((resolve) => {
      // -O0 -g for practice, per doc §5.2 — optimized-away variables would
      // make a student's own stack traces harder to read, not easier.
      const child = spawn('g++', ['-O0', '-g', '-o', artifactPath, filePath], { cwd: options.workingDir })
      let stderr = ''
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('close', (code) => resolve({ success: code === 0, diagnostics: stderr, artifactPath }))
      child.on('error', (err) => resolve({ success: false, diagnostics: err.message }))
    })
  }

  protected executionTarget(_filePath: string, compiled: CompileResult | null) {
    if (!compiled?.artifactPath) {
      throw new Error('CppRunner: run() called without a compiled artifact')
    }
    return { command: compiled.artifactPath, args: [] }
  }

  // Binary is discarded after every run (doc §5.2: "discarded after run
  // unless pinned") — it's a build artifact, not source, and must not end
  // up in the student's auto-committed git history.
  async clean(workingDir: string): Promise<void> {
    await unlink(join(workingDir, ARTIFACT_NAME)).catch(() => undefined)
  }
}
