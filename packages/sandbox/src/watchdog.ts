import type { ChildProcess } from 'node:child_process'
import type { ExecOptions, OutputChunkHandler } from '@practice-ide/shared-types'

export interface WatchdogResult {
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
}

// Bounds worst-case damage from any child process: kills it once it runs
// past timeoutMs, and once its combined stdout+stderr passes maxOutputBytes
// (a runaway print loop can't OOM the renderer either way).
export function attachWatchdog(
  child: ChildProcess,
  options: Pick<ExecOptions, 'timeoutMs' | 'maxOutputBytes'>,
  onChunk: OutputChunkHandler
): Promise<WatchdogResult> {
  return new Promise((resolve) => {
    let bytesWritten = 0
    let truncated = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, options.timeoutMs)

    const forward =
      (stream: 'stdout' | 'stderr') =>
      (data: Buffer): void => {
        if (truncated) return
        bytesWritten += data.length
        if (bytesWritten > options.maxOutputBytes) {
          truncated = true
          onChunk(stream, '\n[output truncated — exceeded output limit]\n')
          child.kill('SIGKILL')
          return
        }
        onChunk(stream, data.toString('utf-8'))
      }

    child.stdout?.on('data', forward('stdout'))
    child.stderr?.on('data', forward('stderr'))

    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, timedOut, truncated })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      onChunk('stderr', `Failed to start process: ${err.message}`)
      resolve({ exitCode: null, timedOut: false, truncated: false })
    })
  })
}
