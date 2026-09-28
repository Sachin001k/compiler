import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { LanguageId } from '@practice-ide/shared-types'

const TEMPLATES: Record<LanguageId, { fileName: string; content: string }> = {
  python: { fileName: 'main.py', content: 'print("hello from practice ide")\n' },
  java: {
    fileName: 'Main.java',
    content:
      'public class Main {\n    public static void main(String[] args) {\n        System.out.println("hello from practice ide");\n    }\n}\n'
  },
  cpp: {
    fileName: 'main.cpp',
    content: '#include <iostream>\n\nint main() {\n    std::cout << "hello from practice ide" << std::endl;\n    return 0;\n}\n'
  }
}

// Backstop for JavaRunner/CppRunner's clean() — if a crash or a future
// runner ever skips cleanup, these patterns still never reach a commit.
const GITIGNORE = '*.class\npractice-ide-attempt.out\npractice-ide-attempt.out.dSYM/\n__pycache__/\n'

export function getWorkspaceDir(): string {
  const dir = join(app.getPath('documents'), 'PracticeIDE', 'workspace')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function getFilePath(language: LanguageId): string {
  const { fileName, content } = TEMPLATES[language]
  const filePath = join(getWorkspaceDir(), fileName)
  if (!existsSync(filePath)) {
    writeFileSync(filePath, content, 'utf-8')
  }
  return filePath
}

// Called once at startup so the Explorer sidebar shows a complete tree
// immediately, rather than only whichever language the student happens to
// open first (getFilePath's create-on-first-open is still there as a
// fallback, but shouldn't be the only path that populates the workspace).
export function ensureWorkspaceInitialized(): string {
  const dir = getWorkspaceDir()

  const gitignorePath = join(dir, '.gitignore')
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GITIGNORE, 'utf-8')
  }

  for (const language of Object.keys(TEMPLATES) as LanguageId[]) {
    getFilePath(language)
  }

  return dir
}
