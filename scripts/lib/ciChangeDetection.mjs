import { hasNativeImpact, listChangedFiles } from './changedFiles.mjs'

const CI_NATIVE_LOGIC_FILES = new Set([
  'scripts/detect-ci-native-impact.mjs',
  'scripts/lib/changedFiles.mjs',
  'scripts/lib/ciChangeDetection.mjs',
])

export function classifyCiNativeImpact(rootDir, base, files) {
  if (files.some(filePath => CI_NATIVE_LOGIC_FILES.has(filePath))) return true
  return hasNativeImpact(rootDir, base, files, { includeWorkflow: true })
}

export function detectCiNativeImpact(rootDir, preferredBase) {
  const { base, files } = listChangedFiles(rootDir, preferredBase)
  return {
    base,
    files,
    native: classifyCiNativeImpact(rootDir, base, files),
  }
}
