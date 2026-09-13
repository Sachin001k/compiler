import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Our own @practice-ide/* workspace packages ship raw TypeScript with no
// build step of their own — they need Vite/esbuild to bundle+transpile them.
// Everything else (better-sqlite3 especially, a native addon) must stay
// external instead, since Rollup can't statically bundle its dynamic
// require() for the compiled .node binary.
const WORKSPACE_PACKAGES = ['@practice-ide/shared-types', '@practice-ide/sandbox', '@practice-ide/language-runners', '@practice-ide/git-sync']

// better-sqlite3 is a transitive dep (pulled in via @practice-ide/git-sync),
// not a direct one in this package.json — externalizeDepsPlugin only reads
// direct "dependencies", so it has to be named explicitly here or it slips
// through and gets (wrongly) bundled.
const TRANSITIVE_NATIVE_DEPS = ['better-sqlite3']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES, include: TRANSITIVE_NATIVE_DEPS })],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PACKAGES, include: TRANSITIVE_NATIVE_DEPS })],
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer'
    }
  }
})
