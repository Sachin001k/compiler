import { spawn } from 'node:child_process'
import { attachWatchdog, spawnSandboxed, type SpawnTarget } from '@practice-ide/sandbox'
import type { CompileResult, ExecOptions, LanguageId, OutputChunkHandler, RunResult, ToolchainInfo } from '@practice-ide/shared-types'
import type { LanguageRunner } from './LanguageRunner'

// Shared implementation for the three runners: `detect()` (spawn a
// version-probe command, parse stdout) and the compile-then-execute
// template are identical in shape across Java/C++/Python — only the
// specific commands differ. That shared state + shared logic is exactly
// why this is an `abstract class` rather than living in the interface
// (see CLAUDE.md's LLD → OOP mapping).
export abstract class BaseRunner implements LanguageRunner {
  abstract readonly id: LanguageId

  protected abstract probeCommand(): SpawnTarget

  // Return null when the language has no separate compile step (Python).
  protected abstract doCompile(filePath: string, options: ExecOptions): Promise<CompileResult | null>

  protected abstract executionTarget(filePath: string, compiled: CompileResult | null): SpawnTarget

  async detect(): Promise<ToolchainInfo | null> {
    const { command, args } = this.probeCommand()
    return new Promise((resolve) => {
      const child = spawn(command, args)
      let out = ''
      child.stdout.on('data', (d) => (out += d.toString()))
      child.stderr.on('data', (d) => (out += d.toString()))
      child.on('close', (code) => resolve(code === 0 ? { id: this.id, version: out.trim() } : null))
      child.on('error', () => resolve(null))
    })
  }

  async run(filePath: string, options: ExecOptions, onChunk: OutputChunkHandler, stdin = ''): Promise<RunResult> {
    const toolchain = await this.detect()
    if (!toolchain) {
      return { exitCode: null, timedOut: false, truncated: false, toolchainMissing: true }
    }

    const compiled = await this.doCompile(filePath, options)
    if (compiled && !compiled.success) {
      onChunk('stderr', compiled.diagnostics)
      return {
        exitCode: null,
        timedOut: false,
        truncated: false,
        toolchainMissing: false,
        compileError: compiled.diagnostics
      }
    }

    const target = this.executionTarget(filePath, compiled)
    const child = spawnSandboxed(target, options)
    // Always close stdin (after writing it, if any) — otherwise a student's
    // accidental input() call just hangs the pipe open until the watchdog's
    // timeout finally kills it, instead of failing fast.
    child.stdin?.end(stdin)
    const result = await attachWatchdog(child, options, onChunk)
    return { ...result, toolchainMissing: false }
  }

  async clean(_workingDir: string): Promise<void> {
    // No-op by default. Override for runners that leave artifacts behind
    // (e.g. CppRunner's compiled binary, JavaRunner's .class files).
  }
}
