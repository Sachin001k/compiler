import type { ExecOptions, LanguageId, OutputChunkHandler, RunResult, ToolchainInfo } from '@practice-ide/shared-types'

// Pure contract — Java, C++, and Python runners share no state and no
// implementation, only this shape. That's why this is an `interface` and
// not a class (see CLAUDE.md's LLD → OOP mapping).
export interface LanguageRunner {
  readonly id: LanguageId
  detect(): Promise<ToolchainInfo | null>
  run(filePath: string, options: ExecOptions, onChunk: OutputChunkHandler, stdin?: string): Promise<RunResult>
  // Removes any compiled artifact left in workingDir (a .class file, a
  // compiled binary) — must be called after every run, before the caller
  // auto-commits, or build artifacts end up checked into the student's
  // git history alongside their source.
  clean(workingDir: string): Promise<void>
}
