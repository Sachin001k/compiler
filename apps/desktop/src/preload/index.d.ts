import type { PracticeIdeApi } from './index'

declare global {
  interface Window {
    api: PracticeIdeApi
  }
}
