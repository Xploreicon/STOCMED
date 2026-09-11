import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import capacitorConfig from '@/capacitor.config'

const CANONICAL_WEB_ORIGIN = 'https://www.askstocmed.com'
const CANONICAL_ICON_SHA256 =
  'ed57b4b094e8e4ee7263277d484335e01326e52ff4f4677a8af9d0a627d15ae8'
const ANDROID_LAUNCHER_SET_SHA256 =
  '71c65bbe84c6b934e06572622dbcf599ebfb96ad3583a9f7b1a093a9d79b069f'

const sha256 = (contents: Buffer | string) =>
  createHash('sha256').update(contents).digest('hex')

const launcherIconSetSha256 = () => {
  const projectRoot = process.cwd()
  const resourceRoot = join(projectRoot, 'android/app/src/main/res')
  const launcherPaths = readdirSync(resourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('mipmap-'))
    .flatMap((entry) => {
      const directory = join(resourceRoot, entry.name)

      return readdirSync(directory)
        .filter((fileName) =>
          /^ic_launcher(?:_background|_foreground|_round)?\.(png|xml)$/.test(
            fileName,
          ),
        )
        .map((fileName) => join(directory, fileName))
    })
    .sort()

  const digest = createHash('sha256')

  for (const launcherPath of launcherPaths) {
    digest.update(relative(projectRoot, launcherPath))
    digest.update('\0')
    digest.update(readFileSync(launcherPath))
    digest.update('\0')
  }

  return digest.digest('hex')
}

describe('Android server-backed shell', () => {
  it('loads the canonical www origin without an apex redirect', () => {
    expect(capacitorConfig.server?.url).toBe(CANONICAL_WEB_ORIGIN)
  })

  it('flushes authentication cookies through Android CookieManager', () => {
    expect(capacitorConfig.plugins?.CapacitorCookies?.enabled).toBe(true)
  })

  it('keeps the Play listing artwork as the canonical icon source', () => {
    expect(sha256(readFileSync(join(process.cwd(), 'assets/icon.png')))).toBe(
      CANONICAL_ICON_SHA256,
    )
  })

  it('keeps every Android launcher variant generated from the canonical icon', () => {
    expect(launcherIconSetSha256()).toBe(ANDROID_LAUNCHER_SET_SHA256)
  })
})
