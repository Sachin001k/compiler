import type { BrowserWindow } from 'electron'
import * as pty from 'node-pty'

// One interactive shell per window, independent of the Run/Output flow —
// students get a real terminal (doc §5.5 VS Code parity: "raw REPL") without
// it being wired to a specific run's stdin.
export class TerminalSession {
  private ptyProcess: pty.IPty | null = null

  constructor(
    private readonly cwd: string,
    private readonly window: BrowserWindow
  ) {}

  start(): void {
    if (this.ptyProcess) return

    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env['SHELL'] || '/bin/bash'
    this.ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: this.cwd,
      env: process.env as Record<string, string>
    })

    this.ptyProcess.onData((data) => {
      this.window.webContents.send('terminal-data', data)
    })

    this.ptyProcess.onExit(() => {
      this.ptyProcess = null
    })
  }

  write(data: string): void {
    this.ptyProcess?.write(data)
  }

  resize(cols: number, rows: number): void {
    this.ptyProcess?.resize(cols, rows)
  }

  dispose(): void {
    this.ptyProcess?.kill()
    this.ptyProcess = null
  }
}
