import type { CompileResult, LanguageId } from '@practice-ide/shared-types'
import { BaseRunner } from './BaseRunner'

export class PythonRunner extends BaseRunner {
  readonly id: LanguageId = 'python'

  protected probeCommand() {
    return { command: 'python3', args: ['--version'] }
  }

  protected async doCompile(): Promise<CompileResult | null> {
    return null
  }

  protected executionTarget(filePath: string) {
    // -I: isolated mode — ignores the user's site-packages and env vars.
    return { command: 'python3', args: ['-I', filePath] }
  }
}
