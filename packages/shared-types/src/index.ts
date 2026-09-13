export type LanguageId = 'python' | 'java' | 'cpp'

export type OutputStream = 'stdout' | 'stderr'

export type OutputChunkHandler = (stream: OutputStream, text: string) => void

// Every runner call must set all of these explicitly — no execution is
// allowed to run unbounded (CLAUDE.md convention).
export interface ExecOptions {
  timeoutMs: number
  memoryLimitMb: number
  cpuLimitPct?: number
  maxOutputBytes: number
  workingDir: string
}

export interface ToolchainInfo {
  id: LanguageId
  version: string
}

export interface CompileResult {
  success: boolean
  diagnostics: string
  artifactPath?: string
}

export interface RunResult {
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  toolchainMissing: boolean
  compileError?: string
}
