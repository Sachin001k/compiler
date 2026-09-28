import { readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { FileTreeNode } from '@practice-ide/shared-types'

const IGNORED_ENTRIES = new Set(['.git'])

export function buildFileTree(dir: string, base: string = dir): FileTreeNode[] {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !IGNORED_ENTRIES.has(entry.name))
    .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))

  return entries.map((entry) => {
    const fullPath = join(dir, entry.name)
    const relativePath = relative(base, fullPath)
    return entry.isDirectory()
      ? { name: entry.name, relativePath, isDirectory: true, children: buildFileTree(fullPath, base) }
      : { name: entry.name, relativePath, isDirectory: false }
  })
}

// The renderer only ever sends a relative path (see preload's readAnyFile/
// writeAnyFile) — this is the guard that keeps that path pinned inside the
// workspace even if a relativePath ever contained "../" segments.
export function resolveWorkspacePath(workspaceDir: string, relativePath: string): string {
  const resolved = resolve(workspaceDir, relativePath)
  if (resolved !== workspaceDir && !resolved.startsWith(workspaceDir + sep)) {
    throw new Error('Path escapes workspace directory')
  }
  return resolved
}
