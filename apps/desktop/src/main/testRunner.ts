import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveRunner } from '@practice-ide/language-runners'
import type { ExecOptions, LanguageId } from '@practice-ide/shared-types'

export interface TestCase {
  name: string
  stdin: string
  expectedOutput: string
}

export interface TestCaseResult extends TestCase {
  passed: boolean
  actualOutput: string
  exitCode: number | null
  timedOut: boolean
}

// One trivial case per language matching the workspace's starter template,
// so the Tests panel shows something real instead of an empty list on first
// run. Real assignments overwrite this file (teacher-provided cases, per
// doc §2/§11) once Phase 4's assignment service exists.
const DEFAULT_TESTS: Record<LanguageId, TestCase[]> = {
  python: [{ name: 'prints greeting', stdin: '', expectedOutput: 'hello from practice ide\n' }],
  java: [{ name: 'prints greeting', stdin: '', expectedOutput: 'hello from practice ide\n' }],
  cpp: [{ name: 'prints greeting', stdin: '', expectedOutput: 'hello from practice ide\n' }]
}

function testsFilePath(workspaceDir: string, language: LanguageId): string {
  const dir = join(workspaceDir, 'tests')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${language}.json`)
}

export function loadTestCases(workspaceDir: string, language: LanguageId): TestCase[] {
  const filePath = testsFilePath(workspaceDir, language)
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${JSON.stringify(DEFAULT_TESTS[language], null, 2)}\n`, 'utf-8')
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as TestCase[]
}

// Called once at startup, same reasoning as workspace.ts's
// ensureWorkspaceInitialized() — the Explorer sidebar should show all three
// languages' test files immediately, not just whichever one the student
// happens to run tests for first.
export function ensureDefaultTestFiles(workspaceDir: string): void {
  for (const language of Object.keys(DEFAULT_TESTS) as LanguageId[]) {
    loadTestCases(workspaceDir, language)
  }
}

export async function runTests(
  workspaceDir: string,
  language: LanguageId,
  filePath: string,
  options: Omit<ExecOptions, 'workingDir'>
): Promise<TestCaseResult[]> {
  const cases = loadTestCases(workspaceDir, language)
  const runner = resolveRunner(language)
  const results: TestCaseResult[] = []

  // Recompiles once per case rather than once total — fine at practice
  // scale (a handful of cases), not worth the caching complexity yet.
  for (const testCase of cases) {
    let actualOutput = ''
    const result = await runner.run(
      filePath,
      { ...options, workingDir: workspaceDir },
      (_stream, text) => {
        actualOutput += text
      },
      testCase.stdin
    )
    results.push({
      ...testCase,
      actualOutput,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      passed: !result.timedOut && !result.toolchainMissing && !result.compileError && actualOutput === testCase.expectedOutput
    })
  }

  // Same reason as the run-code handler: don't leave a compiled artifact
  // sitting in the workspace for the next auto-commit to sweep up.
  await runner.clean(workspaceDir)

  return results
}
