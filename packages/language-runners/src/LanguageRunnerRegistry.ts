import type { LanguageId } from '@practice-ide/shared-types'
import { CppRunner } from './CppRunner'
import type { LanguageRunner } from './LanguageRunner'
import { JavaRunner } from './JavaRunner'
import { PythonRunner } from './PythonRunner'

// A simple lookup, not a factory hierarchy — there's nothing to build per
// call, just one instance per language (CLAUDE.md's LLD → OOP mapping).
const runners: Record<LanguageId, LanguageRunner> = {
  python: new PythonRunner(),
  java: new JavaRunner(),
  cpp: new CppRunner()
}

export function resolveRunner(id: LanguageId): LanguageRunner {
  return runners[id]
}
