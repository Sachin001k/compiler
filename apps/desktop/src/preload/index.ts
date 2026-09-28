import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FileTreeNode, LanguageId } from '@practice-ide/shared-types'

export interface LoadFileResult {
  filePath: string
  content: string
}

export interface RunResult {
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  toolchainMissing: boolean
  compileError?: string
  commitSha: string | null
  pendingSync: number
}

export interface TestCaseResult {
  name: string
  stdin: string
  expectedOutput: string
  actualOutput: string
  exitCode: number | null
  timedOut: boolean
  passed: boolean
}

export type OutputStream = 'stdout' | 'stderr'

export interface ExplainErrorResult {
  explanation?: string
  error?: string
}

// The only surface the renderer ever gets — no raw ipcRenderer, no Node APIs.
const api = {
  loadFile: (language: LanguageId): Promise<LoadFileResult> => ipcRenderer.invoke('load-file', language),
  saveFile: (language: LanguageId, content: string): Promise<{ savedAt: number }> =>
    ipcRenderer.invoke('save-file', language, content),
  runCode: (language: LanguageId, content: string): Promise<RunResult> => ipcRenderer.invoke('run-code', language, content),
  runTests: (language: LanguageId, content: string): Promise<TestCaseResult[]> =>
    ipcRenderer.invoke('run-tests', language, content),
  listWorkspaceTree: (): Promise<FileTreeNode[]> => ipcRenderer.invoke('list-workspace-tree'),
  readAnyFile: (relativePath: string): Promise<{ content: string }> => ipcRenderer.invoke('read-any-file', relativePath),
  writeAnyFile: (relativePath: string, content: string): Promise<{ savedAt: number }> =>
    ipcRenderer.invoke('write-any-file', relativePath, content),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  browseListTree: (): Promise<FileTreeNode[]> => ipcRenderer.invoke('browse-list-tree'),
  browseReadFile: (relativePath: string): Promise<{ content: string }> => ipcRenderer.invoke('browse-read-file', relativePath),
  browseWriteFile: (relativePath: string, content: string): Promise<{ savedAt: number }> =>
    ipcRenderer.invoke('browse-write-file', relativePath, content),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('has-api-key'),
  setApiKey: (key: string): Promise<void> => ipcRenderer.invoke('set-api-key', key),
  explainError: (errorText: string): Promise<ExplainErrorResult> => ipcRenderer.invoke('explain-error', errorText),
  syncStatus: (): Promise<{ pending: number }> => ipcRenderer.invoke('sync-status'),
  syncNow: (): Promise<{ pending: number }> => ipcRenderer.invoke('sync-now'),
  onRunOutput: (callback: (stream: OutputStream, text: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, payload: { stream: OutputStream; text: string }): void =>
      callback(payload.stream, payload.text)
    ipcRenderer.on('run-output', listener)
    return () => ipcRenderer.removeListener('run-output', listener)
  },
  terminalStart: (): Promise<void> => ipcRenderer.invoke('terminal-start'),
  terminalInput: (data: string): Promise<void> => ipcRenderer.invoke('terminal-input', data),
  terminalResize: (cols: number, rows: number): Promise<void> => ipcRenderer.invoke('terminal-resize', cols, rows),
  onTerminalData: (callback: (data: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, data: string): void => callback(data)
    ipcRenderer.on('terminal-data', listener)
    return () => ipcRenderer.removeListener('terminal-data', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type PracticeIdeApi = typeof api
