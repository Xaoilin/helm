import { copyFile, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const indexPath = resolve(rootDir, 'dist', 'index.html')
const fallbackPath = resolve(rootDir, 'dist', '404.html')

await copyFile(indexPath, fallbackPath)

const [indexHtml, fallbackHtml] = await Promise.all([
  readFile(indexPath),
  readFile(fallbackPath),
])

if (!indexHtml.equals(fallbackHtml)) {
  throw new Error('GitHub Pages SPA fallback does not match dist/index.html.')
}

console.log('Created dist/404.html for Sabah One direct routes.')
