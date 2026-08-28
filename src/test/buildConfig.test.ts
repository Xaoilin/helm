// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveAssetBase, vitestExcludedPaths } from '../../vite.config'

describe('build asset base', () => {
  it('keeps GitHub Pages under /helm/', () => {
    expect(resolveAssetBase()).toBe('/helm/')
  })
})

describe('test discovery boundaries', () => {
  it('excludes project-owned AI integrations from HELM test discovery', () => {
    expect(vitestExcludedPaths).toContain('.ai/**')
  })
})
