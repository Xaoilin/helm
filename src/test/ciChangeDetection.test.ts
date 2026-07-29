// @vitest-environment node
import { classifyCiNativeImpact } from '../../scripts/lib/ciChangeDetection.mjs'

describe('CI native-impact detection', () => {
  it('runs the native matrix for CI workflow changes', () => {
    expect(classifyCiNativeImpact(process.cwd(), 'HEAD', [
      '.github/workflows/ci.yml',
    ])).toBe(true)
    expect(classifyCiNativeImpact(process.cwd(), 'HEAD', [
      'scripts/lib/changedFiles.mjs',
    ])).toBe(true)
  })

  it('skips the native matrix for frontend-only changes', () => {
    expect(classifyCiNativeImpact(process.cwd(), 'HEAD', [
      'src/surfaces/ProjectsSurface.tsx',
      'src/App.css',
    ])).toBe(false)
  })
})
