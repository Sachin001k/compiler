import { spawn } from 'node:child_process'

export interface GitResult {
  code: number | null
  stdout: string
  stderr: string
}

export function runGit(args: string[], cwd: string): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.on('error', (err) => resolve({ code: null, stdout: '', stderr: err.message }))
  })
}
