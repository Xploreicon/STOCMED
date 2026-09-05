import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const serviceWorker = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

function createFetchHandler(
  fetchResponse: Promise<Response>,
  offlineResponse = new Response('offline', { headers: { 'content-type': 'text/html' } })
) {
  const handlers = new Map<string, (event: {
    request: {
      method: string
      mode: string
      url: string
    }
    respondWith(response: Promise<Response | undefined>): void
  }) => void>()

  const self = {
    location: { origin: 'https://stocmed.test' },
    addEventListener: (type: string, handler: (typeof handlers extends Map<string, infer T> ? T : never)) => {
      handlers.set(type, handler)
    },
  }

  runInNewContext(serviceWorker, {
    self,
    caches: {
      match: () => Promise.resolve(offlineResponse),
    },
    fetch: () => fetchResponse,
    URL,
    Response,
  })

  const handler = handlers.get('fetch')
  if (!handler) {
    throw new Error('Service worker did not register a fetch handler')
  }

  return handler
}

function dispatchNavigation(
  handler: ReturnType<typeof createFetchHandler>
) {
  let responsePromise: Promise<Response | undefined> | undefined

  handler({
    request: {
      method: 'GET',
      mode: 'navigate',
      url: 'https://stocmed.test/',
    },
    respondWith: (response) => {
      responsePromise = response
    },
  })

  if (!responsePromise) {
    throw new Error('Navigation was not handled by the service worker')
  }

  return responsePromise
}

describe('service worker navigation handling', () => {
  it('registers Web Push display and click-through handlers', () => {
    expect(serviceWorker).toContain("self.addEventListener('push'")
    expect(serviceWorker).toContain('self.registration.showNotification')
    expect(serviceWorker).toContain("self.addEventListener('notificationclick'")
    expect(serviceWorker).toContain('self.clients.openWindow')
    expect(serviceWorker).toContain("href.startsWith('/')")
  })

  it('does not precache routes that can redirect', () => {
    const assetsBlock = serviceWorker.match(/const ASSETS_TO_CACHE = \[([\s\S]*?)\];/)?.[1]

    expect(assetsBlock).toBeDefined()
    expect(assetsBlock).not.toMatch(/['"]\/['"]/)
    expect(assetsBlock).not.toContain("'/dashboard'")
    expect(assetsBlock).not.toContain("'/chat'")
    expect(assetsBlock).toContain("'/offline.html'")
  })

  it('returns a clean response after the network follows a navigation redirect', async () => {
    const redirectedResponse = new Response('<h1>Login</h1>', {
      status: 200,
      headers: {
        'content-type': 'text/html',
        'x-stocmed-route': 'login',
      },
    })
    Object.defineProperty(redirectedResponse, 'redirected', { value: true })

    const result = await dispatchNavigation(
      createFetchHandler(Promise.resolve(redirectedResponse))
    )

    expect(result).toBeDefined()
    expect(result?.redirected).toBe(false)
    expect(result?.status).toBe(200)
    expect(result?.headers.get('x-stocmed-route')).toBe('login')
    await expect(result?.text()).resolves.toBe('<h1>Login</h1>')
  })

  it('returns the offline shell when a navigation network request fails', async () => {
    const offlineResponse = new Response('<h1>Offline</h1>', {
      headers: { 'content-type': 'text/html' },
    })
    const result = await dispatchNavigation(
      createFetchHandler(Promise.reject(new TypeError('offline')), offlineResponse)
    )

    expect(result).toBe(offlineResponse)
    await expect(result?.text()).resolves.toBe('<h1>Offline</h1>')
  })
})
