import Anthropic from '@anthropic-ai/sdk'
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MODEL = 'claude-opus-5'

// Manual, post-hoc only — the renderer only ever calls explainError() after
// a real run/compile failure, from an explicit button click. Never
// auto-triggered while the student is typing, never writes back into the
// editor: this is feedback about code the student already ran, not a
// suggestion while they're thinking (doc §5.1's own rule of thumb for what
// this product allows). Only the error text is sent, never the source file.
const SYSTEM_PROMPT =
  'You explain compiler/interpreter error messages to a student learning to program. ' +
  'Explain what the error means and why it likely happened, in plain language. ' +
  'Do not write corrected code or a full solution, even if asked — the student must fix it themselves. ' +
  'Keep it concise.'

function keyFilePath(userDataDir: string): string {
  return join(userDataDir, 'claude-api-key.enc')
}

export function hasApiKey(userDataDir: string): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY']) || existsSync(keyFilePath(userDataDir))
}

export function setApiKey(userDataDir: string, key: string): void {
  writeFileSync(keyFilePath(userDataDir), safeStorage.encryptString(key))
}

function getApiKey(userDataDir: string): string | null {
  const envKey = process.env['ANTHROPIC_API_KEY']
  if (envKey) return envKey

  const filePath = keyFilePath(userDataDir)
  if (!existsSync(filePath)) return null
  return safeStorage.decryptString(readFileSync(filePath))
}

export async function explainError(userDataDir: string, errorText: string): Promise<string> {
  const apiKey = getApiKey(userDataDir)
  if (!apiKey) {
    throw new Error('No Claude API key set — run "Set Claude API Key…" from the command palette first.')
  }

  const client = new Anthropic({ apiKey })
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: errorText }]
  })

  const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text')
  return textBlock?.text ?? '(no explanation returned)'
}
