import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Loopback only: serves the exported package, never starts Next or contacts an API.
const output = path.resolve(fileURLToPath(new URL('../out/', import.meta.url)))
const port = Number(process.env.PATIENT_STATIC_PORT || '4173')
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local static port')
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' }

async function exportedFile(rawUrl) {
  const pathname = decodeURIComponent(new URL(rawUrl || '/', 'http://127.0.0.1').pathname)
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const relative = pathname.replace(/^\/+/, '')
  const candidates = [relative, path.join(relative, 'index.html'), `${relative}.html`]
  for (const candidate of candidates) {
    const resolved = path.resolve(output, candidate)
    if (!resolved.startsWith(`${output}${path.sep}`)) continue
    try { if ((await stat(resolved)).isFile()) return resolved } catch { /* next candidate */ }
  }
  return null
}

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) { response.writeHead(405).end(); return }
  try {
    const file = await exportedFile(request.url)
    if (!file) { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return }
    const body = await readFile(file)
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    response.end(request.method === 'HEAD' ? undefined : body)
  } catch { response.writeHead(400).end('Invalid request') }
})
server.listen(port, '127.0.0.1', () => console.log(`Patient export: http://127.0.0.1:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
