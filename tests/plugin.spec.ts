import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'

/** The package manifest, read the way the loader and pnpm read it. */
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  name: string
  main: string
  dsh?: { client?: { platform?: string } }
  exports: Record<string, unknown>
}

describe('@skillre/dsh-plugin-tavily-firecrawl', () => {
  it('exports the minimal Cordis function-plugin contract', () => {
    expect(plugin.name).toBe('skillre-tavily-firecrawl')
    expect(plugin.apply).toBeTypeOf('function')
    expect('default' in plugin).toBe(false)
  })

  it('declares its browser half consistently with the artifact it ships', () => {
    const client = manifest.dsh?.client
    if (client === undefined) {
      expect(manifest.exports['./client']).toBeUndefined()
      return
    }
    // A declared browser half must be reachable through the manifest the shell
    // resolves, and the bundle must already exist: a git-hosted install runs
    // no build scripts, so what is on disk is what a user gets.
    expect(client.platform).toBe('web')
    expect(manifest.exports['./client']).toEqual({ default: './lib/client.js' })
    // pnpm resolves `main` against the package root when deciding whether a
    // git-hosted checkout needs building, so it must point into `lib/`.
    expect(manifest.main.replace(/^\.\//, '')).toBe('lib/index.js')

    const artifact = new URL('../lib/client.js', import.meta.url)
    expect(existsSync(artifact), 'build:client must produce lib/client.js before tests run').toBe(true)
    const bundle = readFileSync(artifact, 'utf8')
    expect(bundle, 'the envelope id must equal the package name').toContain(`id: ${JSON.stringify(manifest.name)}`)
    expect(bundle, 'the page registers into the bundle configuration slot').toContain('plugins.bundle.config')
    expect(bundle, 'the page writes through the credentials namespace').toContain('remote.credentials')
    expect(bundle, 'react stays external, served by the browser module table').toContain('require("react")')
  })
})
