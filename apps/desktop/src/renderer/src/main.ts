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
type PanelId = 'output' | 'terminal' | 'tests'

const editorContainer = document.getElementById('editor') as HTMLDivElement
const outputEl = document.getElementById('output') as HTMLPreElement
const testsEl = document.getElementById('tests') as HTMLDivElement
const terminalContainer = document.getElementById('terminal') as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLSpanElement
const runButton = document.getElementById('run') as HTMLButtonElement
const saveButton = document.getElementById('save') as HTMLButtonElement
const runTestsButton = document.getElementById('runTests') as HTMLButtonElement
const languageSelect = document.getElementById('language') as HTMLSelectElement
const panelTabs = document.querySelectorAll<HTMLButtonElement>('#panelTabs .tab')

let editor: monaco.editor.IStandaloneCodeEditor
let currentLanguage: LanguageId = 'python'

// ---------- editor ----------

async function loadLanguage(language: LanguageId): Promise<void> {
  currentLanguage = language
  languageSelect.value = language
  const { filePath, content } = await window.api.loadFile(language)
  monaco.editor.setModelLanguage(editor.getModel()!, language)
  editor.setValue(content)
  statusEl.textContent = filePath
}

async function run(): Promise<void> {
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
}

async function save(): Promise<void> {
  await window.api.saveFile(currentLanguage, editor.getValue())
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
  showPanel('tests')
  testsEl.textContent = 'Running tests…'
  runTestsButton.disabled = true
  const results = await window.api.runTests(currentLanguage, editor.getValue())
  renderTestResults(results)
  runTestsButton.disabled = false
}

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
  { label: 'Switch language: C++', run: () => void loadLanguage('cpp') }
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

    // kept on — editing mechanics, not assistance
    minimap: { enabled: true },
    bracketPairColorization: { enabled: true },
    autoClosingBrackets: 'never'
  })

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
