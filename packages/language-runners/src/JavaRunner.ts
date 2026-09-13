import { spawn } from 'node:child_process'
import { readdir, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { CompileResult, ExecOptions, LanguageId } from '@practice-ide/shared-types'
import { BaseRunner } from './BaseRunner'

export class JavaRunner extends BaseRunner {
  readonly id: LanguageId = 'java'

  protected probeCommand() {
    return { command: 'javac', args: ['-version'] }
  }

  protected doCompile(filePath: string, options: ExecOptions): Promise<CompileResult> {
    return new Promise((resolve) => {
      const child = spawn('javac', [filePath], { cwd: options.workingDir })
      let stderr = ''
      child.stderr.on('data', (d) => (stderr += d.toString()))
      child.on('close', (code) => resolve({ success: code === 0, diagnostics: stderr }))
      child.on('error', (err) => resolve({ success: false, diagnostics: err.message }))
    })
  }

  protected executionTarget(filePath: string) {
    // One class per attempt folder, scoped classpath (doc §5.2) — assumes
    // the public class name matches the filename, standard Java convention.
    const className = basename(filePath).replace(/\.java$/, '')
    return { command: 'java', args: ['-cp', dirname(filePath), className] }
  }

  // javac can emit more than one .class file per source file (nested/inner/
  // anonymous classes), so delete anything it left rather than predicting
  // exact names — these are build artifacts, not source, and must not end
  // up in the student's auto-committed git history.
  async clean(workingDir: string): Promise<void> {
    const entries = await readdir(workingDir).catch(() => [] as string[])
    await Promise.all(
      entries.filter((name) => name.endsWith('.class')).map((name) => unlink(join(workingDir, name)).catch(() => undefined))
    )
  }
}
