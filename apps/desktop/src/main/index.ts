import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ConnectivityWatcher, LocalRepoManager, Outbox, SyncWorker } from '@practice-ide/git-sync'
import { resolveRunner } from '@practice-ide/language-runners'
import type { ExecOptions, LanguageId } from '@practice-ide/shared-types'
import { explainError, hasApiKey, setApiKey } from './claudeAssistant'
import { buildFileTree, resolveWorkspacePath } from './fileExplorer'
import { TerminalSession } from './terminal'
import { ensureDefaultTestFiles, runTests } from './testRunner'
import { ensureWorkspaceInitialized, getFilePath } from './workspace'

const RUN_OPTIONS: Omit<ExecOptions, 'workingDir'> = {
  timeoutMs: 10_000,
  memoryLimitMb: 256,
  maxOutputBytes: 200_000
}

const WORKSPACE_ID = 'default'

let mainWindow: BrowserWindow | null = null
let terminal: TerminalSession | null = null
// A folder the student opened via "Open Folder…" to browse/edit — separate
// from `workspaceDir` on purpose. Run/Run Tests only ever operate on the
// fixed practice workspace (doc's "filesystem scope restricted to the
// workspace" principle); this is browse/edit-only, never executed.
let browseRoot: string | null = null

const workspaceDir = ensureWorkspaceInitialized()
ensureDefaultTestFiles(workspaceDir)
const userDataDir = app.getPath('userData')

const repo = new LocalRepoManager(workspaceDir)
const outbox = new Outbox(join(userDataDir, 'app.db'))
const connectivity = new ConnectivityWatcher()
const syncWorker = new SyncWorker(outbox, connectivity)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  terminal = new TerminalSession(workspaceDir, mainWindow)

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('load-file', (_event, language: LanguageId) => {
  const filePath = getFilePath(language)
  return { filePath, content: readFileSync(filePath, 'utf-8') }
})

ipcMain.handle('save-file', (_event, language: LanguageId, content: string) => {
  writeFileSync(getFilePath(language), content, 'utf-8')
  return { savedAt: Date.now() }
})

ipcMain.handle('run-code', async (_event, language: LanguageId, content: string) => {
  const filePath = getFilePath(language)
  writeFileSync(filePath, content, 'utf-8')

  const runner = resolveRunner(language)
  const result = await runner.run(filePath, { ...RUN_OPTIONS, workingDir: workspaceDir }, (stream, text) => {
    mainWindow?.webContents.send('run-output', { stream, text })
  })

  // Must happen before the commit below — otherwise a compiled .class file
  // or binary gets swept up by `git add .` alongside the student's source.
  await runner.clean(workspaceDir)

  let commitSha: string | null = null
  if (!result.toolchainMissing) {
    const attemptNumber = (await repo.attemptCount()) + 1
    commitSha = await repo.commitAttempt(attemptNumber, result.exitCode)
    if (commitSha) outbox.enqueue(WORKSPACE_ID, commitSha)
  }

  return { ...result, commitSha, pendingSync: outbox.pending().length }
})

ipcMain.handle('run-tests', async (_event, language: LanguageId, content: string) => {
  const filePath = getFilePath(language)
  writeFileSync(filePath, content, 'utf-8')
  return runTests(workspaceDir, language, filePath, RUN_OPTIONS)
})

ipcMain.handle('list-workspace-tree', () => buildFileTree(workspaceDir))

ipcMain.handle('read-any-file', (_event, relativePath: string) => {
  const filePath = resolveWorkspacePath(workspaceDir, relativePath)
  return { content: readFileSync(filePath, 'utf-8') }
})

ipcMain.handle('write-any-file', (_event, relativePath: string, content: string) => {
  const filePath = resolveWorkspacePath(workspaceDir, relativePath)
  writeFileSync(filePath, content, 'utf-8')
  return { savedAt: Date.now() }
})

ipcMain.handle('pick-folder', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  browseRoot = result.filePaths[0]
  return browseRoot
})

ipcMain.handle('browse-list-tree', () => (browseRoot ? buildFileTree(browseRoot) : []))

ipcMain.handle('browse-read-file', (_event, relativePath: string) => {
  if (!browseRoot) throw new Error('No folder open')
  const filePath = resolveWorkspacePath(browseRoot, relativePath)
  return { content: readFileSync(filePath, 'utf-8') }
})

ipcMain.handle('browse-write-file', (_event, relativePath: string, content: string) => {
  if (!browseRoot) throw new Error('No folder open')
  const filePath = resolveWorkspacePath(browseRoot, relativePath)
  writeFileSync(filePath, content, 'utf-8')
  return { savedAt: Date.now() }
})

ipcMain.handle('has-api-key', () => hasApiKey(userDataDir))

ipcMain.handle('set-api-key', (_event, key: string) => {
  setApiKey(userDataDir, key)
})

ipcMain.handle('explain-error', async (_event, errorText: string) => {
  try {
    return { explanation: await explainError(userDataDir, errorText) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
})

ipcMain.handle('sync-status', () => ({ pending: outbox.pending().length }))

ipcMain.handle('sync-now', async () => {
  await syncWorker.drain()
  return { pending: outbox.pending().length }
})

ipcMain.handle('terminal-start', () => terminal?.start())
ipcMain.handle('terminal-input', (_event, data: string) => terminal?.write(data))
ipcMain.handle('terminal-resize', (_event, cols: number, rows: number) => terminal?.resize(cols, rows))

app.whenReady().then(() => {
  createWindow()
  connectivity.start()
})

app.on('window-all-closed', () => {
  connectivity.stop()
  outbox.close()
  terminal?.dispose()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
