import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution'
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution'
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { TestCaseResult } from '../../preload/index'
import './style.css'

// Tokenizer/bracket-matching only — basic-languages never registers a
// completion, hover, or signature-help provider. That's the whole point.
self.MonacoEnvironment = {
  getWorker(): Worker {
    return new editorWorker()
  }
}

type LanguageId = 'python' | 'java' | 'cpp'
type PanelId = 'output' | 'terminal' | 'tests' | 'explain'

interface FileTreeNode {
  name: string
  relativePath: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

// The three fixed template files that the language dropdown / Run / Run
// Tests operate on. Any other file the student opens from the Explorer is
// just a plain read/write view (e.g. editing a tests/*.json case) — Run
// stays disabled for those, there's nothing to execute.
const FILE_BY_LANGUAGE: Record<LanguageId, string> = { python: 'main.py', java: 'Main.java', cpp: 'main.cpp' }
const LANGUAGE_BY_FILE: Partial<Record<string, LanguageId>> = {
  'main.py': 'python',
  'Main.java': 'java',
  'main.cpp': 'cpp'
}

const editorContainer = document.getElementById('editor') as HTMLDivElement
const outputEl = document.getElementById('output') as HTMLPreElement
const testsEl = document.getElementById('tests') as HTMLDivElement
const terminalContainer = document.getElementById('terminal') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const runButton = document.getElementById('run') as HTMLButtonElement
const saveButton = document.getElementById('save') as HTMLButtonElement
const runTestsButton = document.getElementById('runTests') as HTMLButtonElement
const explainErrorButton = document.getElementById('explainError') as HTMLButtonElement
const explainEl = document.getElementById('explain') as HTMLDivElement
const languageSelect = document.getElementById('language') as HTMLSelectElement
const panelTabs = document.querySelectorAll<HTMLButtonElement>('#panelTabs .tab')
const fileTreeEl = document.getElementById('fileTree') as HTMLDivElement
const openFolderButton = document.getElementById('openFolder') as HTMLButtonElement
const showWorkspaceButton = document.getElementById('showWorkspace') as HTMLButtonElement
const sidebarRootEl = document.getElementById('sidebarRoot') as HTMLDivElement

let editor: monaco.editor.IStandaloneCodeEditor
let currentLanguage: LanguageId = 'python'
let mode: 'language' | 'generic' = 'language'
let genericRelativePath = ''
let genericSource: 'workspace' | 'browse' = 'workspace'
let activeRelativePath = FILE_BY_LANGUAGE.python
// Which tree the Explorer is currently showing. Opening an external folder
// never affects Run/Run Tests — those stay scoped to the practice
// workspace regardless of what's browsed here (see fileExplorer.ts's
// browseRoot in the main process).
let sidebarSource: 'workspace' | 'browse' = 'workspace'
// The last failed run's captured output — the only thing "Explain Error"
// ever sends to Claude. Never the source file.
let lastErrorText = ''

// ---------- editor ----------

function setRunnableControlsEnabled(enabled: boolean): void {
  runButton.disabled = !enabled
  runTestsButton.disabled = !enabled
}

async function loadLanguage(language: LanguageId): Promise<void> {
  mode = 'language'
  currentLanguage = language
  activeRelativePath = FILE_BY_LANGUAGE[language]
  languageSelect.value = language
  setRunnableControlsEnabled(true)
  explainErrorButton.disabled = true

  // Switching languages always operates on the fixed practice-workspace
  // file underneath, but must NOT disturb whatever the Explorer is showing
  // — if the student has an external folder open via "Open Folder…", it
  // stays open. renderTree() just refreshes the active-file highlight,
  // which is a harmless no-op when the browse tree doesn't contain this
  // path (nothing gets highlighted, nothing gets switched).
  renderTree()

  const { filePath, content } = await window.api.loadFile(language)
  monaco.editor.setModelLanguage(editor.getModel()!, language)
  editor.setValue(content)
  statusEl.textContent = filePath
}

function extensionLanguage(relativePath: string): string {
  if (relativePath.endsWith('.py')) return 'python'
  if (relativePath.endsWith('.java')) return 'java'
  if (relativePath.endsWith('.cpp') || relativePath.endsWith('.h') || relativePath.endsWith('.hpp')) return 'cpp'
  return 'plaintext'
}

async function openGenericFile(relativePath: string, source: 'workspace' | 'browse'): Promise<void> {
  mode = 'generic'
  genericRelativePath = relativePath
  genericSource = source
  activeRelativePath = relativePath
  setRunnableControlsEnabled(false)
  explainErrorButton.disabled = true

  const { content } = await (source === 'workspace' ? window.api.readAnyFile(relativePath) : window.api.browseReadFile(relativePath))
  monaco.editor.setModelLanguage(editor.getModel()!, extensionLanguage(relativePath))
  editor.setValue(content)
  statusEl.textContent = `${relativePath} (view/edit only — not runnable)`
  renderTree()
}

async function run(): Promise<void> {
  if (mode !== 'language') return
  showPanel('output')
  outputEl.textContent = ''
  runButton.disabled = true
  statusEl.textContent = 'running…'

  const result = await window.api.runCode(currentLanguage, editor.getValue())

  if (result.toolchainMissing) {
    outputEl.textContent = `${currentLanguage} toolchain not found on PATH — install it to run code.`
  } else if (result.timedOut) {
    outputEl.textContent += '\n[killed — exceeded time limit]'
  }

  const exit = result.exitCode === null ? 'no exit code' : `exit ${result.exitCode}`
  const commit = result.commitSha ? `commit ${result.commitSha.slice(0, 7)}` : 'no commit'
  statusEl.textContent = `${exit} · ${commit} · ${result.pendingSync} pending sync`
  runButton.disabled = false

  // toolchainMissing is excluded — that message ("install python3") is
  // already the complete, actionable answer; nothing for Claude to add.
  const failed = !result.toolchainMissing && (result.exitCode !== 0 || Boolean(result.compileError) || result.timedOut)
  lastErrorText = failed ? outputEl.textContent || '' : ''
  explainErrorButton.disabled = !failed
}

async function save(): Promise<void> {
  if (mode === 'language') {
    await window.api.saveFile(currentLanguage, editor.getValue())
  } else if (genericSource === 'workspace') {
    await window.api.writeAnyFile(genericRelativePath, editor.getValue())
  } else {
    await window.api.browseWriteFile(genericRelativePath, editor.getValue())
  }
  statusEl.textContent = 'saved'
}

// ---------- panels ----------

function showPanel(panel: PanelId): void {
  document.querySelectorAll('.panel').forEach((el) => el.classList.remove('active'))
  document.getElementById(panel)?.classList.add('active')
  panelTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset['panel'] === panel))
  if (panel === 'terminal') void ensureTerminalStarted()
}

panelTabs.forEach((tab) => {
  tab.addEventListener('click', () => showPanel(tab.dataset['panel'] as PanelId))
})

// ---------- file explorer ----------

let currentTree: FileTreeNode[] = []
const collapsedFolders = new Set<string>()

async function refreshFileTree(): Promise<void> {
  currentTree = sidebarSource === 'workspace' ? await window.api.listWorkspaceTree() : await window.api.browseListTree()
  renderTree()
}

async function setSidebarSource(source: 'workspace' | 'browse'): Promise<void> {
  sidebarSource = source
  showWorkspaceButton.hidden = source === 'workspace'
  await refreshFileTree()
}

async function openFolderPicker(): Promise<void> {
  const picked = await window.api.pickFolder()
  if (!picked) return
  sidebarRootEl.textContent = picked
  await setSidebarSource('browse')
}

async function showPracticeWorkspace(): Promise<void> {
  sidebarRootEl.textContent = ''
  await setSidebarSource('workspace')
}

openFolderButton.addEventListener('click', () => void openFolderPicker())
showWorkspaceButton.addEventListener('click', () => void showPracticeWorkspace())

function renderTree(): void {
  fileTreeEl.innerHTML = ''
  const ul = document.createElement('ul')
  currentTree.forEach((node) => ul.appendChild(renderTreeNode(node)))
  fileTreeEl.appendChild(ul)
}

function renderTreeNode(node: FileTreeNode): HTMLLIElement {
  const li = document.createElement('li')
  const row = document.createElement('div')
  row.className = 'tree-row'
  row.classList.toggle('active', node.relativePath === activeRelativePath)

  if (node.isDirectory) {
    const collapsed = collapsedFolders.has(node.relativePath)
    row.textContent = `${collapsed ? '▸' : '▾'} ${node.name}`
    row.classList.add('tree-folder')
    row.addEventListener('click', () => {
      if (collapsed) collapsedFolders.delete(node.relativePath)
      else collapsedFolders.add(node.relativePath)
      renderTree()
    })
    li.appendChild(row)

    if (!collapsed && node.children) {
      const childUl = document.createElement('ul')
      node.children.forEach((child) => childUl.appendChild(renderTreeNode(child)))
      li.appendChild(childUl)
    }
  } else {
    row.textContent = node.name
    row.classList.add('tree-file')
    row.addEventListener('click', () => {
      if (sidebarSource === 'browse') {
        void openGenericFile(node.relativePath, 'browse')
        return
      }
      const runnableLanguage = LANGUAGE_BY_FILE[node.name]
      void (runnableLanguage ? loadLanguage(runnableLanguage) : openGenericFile(node.relativePath, 'workspace'))
    })
    li.appendChild(row)
  }

  return li
}

// ---------- terminal ----------

let terminalStarted = false

async function ensureTerminalStarted(): Promise<void> {
  if (terminalStarted) return
  terminalStarted = true

  const term = new Terminal({ fontSize: 13, fontFamily: 'Menlo, Consolas, monospace', theme: { background: '#0d1117' } })
  const fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  term.open(terminalContainer)
  fitAddon.fit()

  await window.api.terminalStart()

  term.onData((data) => void window.api.terminalInput(data))
  term.onResize(({ cols, rows }) => void window.api.terminalResize(cols, rows))
  window.api.onTerminalData((data) => term.write(data))

  new ResizeObserver(() => fitAddon.fit()).observe(terminalContainer)
}

// ---------- tests ----------

function renderTestResults(results: TestCaseResult[]): void {
  testsEl.innerHTML = ''
  for (const result of results) {
    const card = document.createElement('div')
    card.className = `test-case ${result.passed ? 'pass' : 'fail'}`

    const timeoutNote = result.timedOut ? ' (timed out)' : ''
    card.innerHTML = `
      <span class="name">${escapeHtml(result.name)}</span>
      <span class="badge">${result.passed ? 'PASS' : 'FAIL'}${timeoutNote}</span>
      ${
        result.passed
          ? ''
          : `<pre>expected: ${escapeHtml(result.expectedOutput)}\nactual:   ${escapeHtml(result.actualOutput)}</pre>`
      }
    `
    testsEl.appendChild(card)
  }
  if (results.length === 0) {
    testsEl.textContent = 'No test cases found.'
  }
}

function escapeHtml(value: string): string {
  const div = document.createElement('div')
  div.textContent = value
  return div.innerHTML
}

async function runTests(): Promise<void> {
  if (mode !== 'language') return
  showPanel('tests')
  testsEl.textContent = 'Running tests…'
  runTestsButton.disabled = true
  const results = await window.api.runTests(currentLanguage, editor.getValue())
  renderTestResults(results)
  runTestsButton.disabled = false
  void refreshFileTree()
}

// ---------- explain error (Claude) ----------

async function explainError(): Promise<void> {
  if (!lastErrorText) return
  showPanel('explain')
  explainEl.textContent = 'Asking Claude…'
  explainErrorButton.disabled = true

  const result = await window.api.explainError(lastErrorText)
  explainEl.textContent = result.explanation ?? result.error ?? '(no response)'

  explainErrorButton.disabled = false
}

explainErrorButton.addEventListener('click', () => void explainError())

// ---------- set Claude API key ----------

const apiKeyOverlay = document.getElementById('apiKeyOverlay') as HTMLDivElement
const apiKeyInput = document.getElementById('apiKeyInput') as HTMLInputElement
const apiKeySaveButton = document.getElementById('apiKeySave') as HTMLButtonElement
const apiKeyCancelButton = document.getElementById('apiKeyCancel') as HTMLButtonElement

function openApiKeyDialog(): void {
  apiKeyOverlay.hidden = false
  apiKeyInput.value = ''
  apiKeyInput.focus()
}

function closeApiKeyDialog(): void {
  apiKeyOverlay.hidden = true
}

async function saveApiKey(): Promise<void> {
  const key = apiKeyInput.value.trim()
  if (!key) return
  await window.api.setApiKey(key)
  closeApiKeyDialog()
  statusEl.textContent = 'Claude API key saved'
}

apiKeySaveButton.addEventListener('click', () => void saveApiKey())
apiKeyCancelButton.addEventListener('click', closeApiKeyDialog)
apiKeyInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void saveApiKey()
  else if (event.key === 'Escape') closeApiKeyDialog()
})
apiKeyOverlay.addEventListener('click', (event) => {
  if (event.target === apiKeyOverlay) closeApiKeyDialog()
})

// ---------- command palette ----------

interface Command {
  label: string
  run: () => void
}

const commands: Command[] = [
  { label: 'Run', run: () => void run() },
  { label: 'Save', run: () => void save() },
  { label: 'Run Tests', run: () => void runTests() },
  { label: 'Show Output panel', run: () => showPanel('output') },
  { label: 'Show Terminal panel', run: () => showPanel('terminal') },
  { label: 'Show Tests panel', run: () => showPanel('tests') },
  { label: 'Switch language: Python', run: () => void loadLanguage('python') },
  { label: 'Switch language: Java', run: () => void loadLanguage('java') },
  { label: 'Switch language: C++', run: () => void loadLanguage('cpp') },
  { label: 'Open Folder…', run: () => void openFolderPicker() },
  { label: 'Show Practice Workspace', run: () => void showPracticeWorkspace() },
  { label: 'Explain Error (Claude)', run: () => void explainError() },
  { label: 'Set Claude API Key…', run: openApiKeyDialog }
]

const paletteOverlay = document.getElementById('commandPaletteOverlay') as HTMLDivElement
const paletteInput = document.getElementById('commandPaletteInput') as HTMLInputElement
const paletteList = document.getElementById('commandPaletteList') as HTMLUListElement
let paletteSelectedIndex = 0
let paletteMatches: Command[] = []

function openPalette(): void {
  paletteOverlay.hidden = false
  paletteInput.value = ''
  paletteSelectedIndex = 0
  renderPaletteMatches()
  paletteInput.focus()
}

function closePalette(): void {
  paletteOverlay.hidden = true
}

function renderPaletteMatches(): void {
  const query = paletteInput.value.trim().toLowerCase()
  paletteMatches = commands.filter((c) => c.label.toLowerCase().includes(query))
  paletteList.innerHTML = ''
  paletteMatches.forEach((command, index) => {
    const li = document.createElement('li')
    li.textContent = command.label
    li.classList.toggle('selected', index === paletteSelectedIndex)
    li.addEventListener('click', () => {
      command.run()
      closePalette()
    })
    paletteList.appendChild(li)
  })
}

paletteInput.addEventListener('input', () => {
  paletteSelectedIndex = 0
  renderPaletteMatches()
})

paletteInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePalette()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    paletteSelectedIndex = Math.min(paletteSelectedIndex + 1, paletteMatches.length - 1)
    renderPaletteMatches()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    paletteSelectedIndex = Math.max(paletteSelectedIndex - 1, 0)
    renderPaletteMatches()
  } else if (event.key === 'Enter') {
    paletteMatches[paletteSelectedIndex]?.run()
    closePalette()
  }
})

paletteOverlay.addEventListener('click', (event) => {
  if (event.target === paletteOverlay) closePalette()
})

window.addEventListener('keydown', (event) => {
  const isPaletteShortcut = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'p'
  if (isPaletteShortcut) {
    event.preventDefault()
    openPalette()
  } else if (event.key === 'Escape' && !paletteOverlay.hidden) {
    // Fallback in case focus isn't in paletteInput for some reason — closing
    // shouldn't depend on which element happens to have focus.
    closePalette()
  } else if (event.key === 'Escape' && !apiKeyOverlay.hidden) {
    closeApiKeyDialog()
  }
})

// ---------- wiring ----------

async function init(): Promise<void> {
  editor = monaco.editor.create(editorContainer, {
    value: '',
    language: currentLanguage,
    automaticLayout: true,
    theme: 'vs-dark',

    // Deliberately suppressed — this list IS the product's core feature.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    parameterHints: { enabled: false },
    wordBasedSuggestions: 'off',
    snippetSuggestions: 'none',
    inlineSuggest: { enabled: false },
    hover: { enabled: false },
    tabCompletion: 'off',

    // kept on — editing mechanics (mirrors a keystroke back), not
    // assistance (never predicts what the student meant to type). Doc
    // §5.1 flagged auto-closing as "arguable — off by default, toggle in
    // settings"; turning it on here is that toggle.
    minimap: { enabled: true },
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: 'languageDefined',
    autoClosingQuotes: 'languageDefined',
    autoIndent: 'full'
  })

  await refreshFileTree()
  await loadLanguage(currentLanguage)

  window.api.onRunOutput((_stream, text) => {
    outputEl.textContent += text
    outputEl.scrollTop = outputEl.scrollHeight
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, run)
}

runButton.addEventListener('click', run)
saveButton.addEventListener('click', save)
runTestsButton.addEventListener('click', runTests)
languageSelect.addEventListener('change', () => void loadLanguage(languageSelect.value as LanguageId))

init()
