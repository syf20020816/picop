/**
 * 将 TanStack Start 的 SSR fetch handler 托管为本地 HTTP 服务
 *
 * dist/server/server.js 默认导出形如 { fetch(request) } 的 fetch handler，
 * 但它不负责前端静态资源。本模块：
 *   1. 优先命中 dist/client 下的真实文件（/assets/*、favicon、manifest 等）
 *   2. 其余请求（页面路由 + /api/*）转成 Web Request 交给 SSR handler
 *   3. 回写 Response 到 node:http（含多 Set-Cookie 处理）
 */

import http from 'node:http'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'

import { CLIENT_DIR, SERVER_ENTRY } from './paths.mjs'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
}

function contentType(filePath) {
  return (
    MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  )
}

let cachedHandler

/** 加载（并缓存）SSR fetch handler，兼容默认导出为对象或函数两种形态 */
async function loadHandler() {
  if (cachedHandler) return cachedHandler
  const mod = await import(pathToFileURL(SERVER_ENTRY).href)
  const entry = mod.default
  cachedHandler = typeof entry === 'function' ? { fetch: entry } : entry
  return cachedHandler
}

/** 命中 dist/client 下的静态文件则直接返回，否则返回 false 交由 SSR 处理 */
async function tryServeStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false

  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return false
  }
  const rel = decoded.replace(/^\/+/, '')
  if (!rel) return false

  const filePath = path.resolve(CLIENT_DIR, rel)
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + path.sep)) {
    return false
  }

  let stat
  try {
    stat = await fsp.stat(filePath)
  } catch {
    return false
  }
  if (!stat.isFile()) return false

  res.statusCode = 200
  res.setHeader('Content-Type', contentType(filePath))
  res.setHeader('Content-Length', stat.size)
  if (req.method === 'HEAD') {
    res.end()
    return true
  }
  await new Promise((resolve, reject) => {
    const fileStream = createReadStream(filePath)
    fileStream.on('error', reject)
    fileStream.on('end', resolve)
    fileStream.pipe(res)
  }).catch(() => res.destroy())
  return true
}

/** node:http IncomingMessage → Web Request */
function toWebRequest(req, origin) {
  const method = req.method || 'GET'
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v))
    else if (value !== undefined) headers.append(key, value)
  }
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(origin + req.url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? 'half' : undefined,
  })
}

/** Web Response → node:http ServerResponse */
async function writeWebResponse(res, response) {
  res.statusCode = response.status
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') continue
    res.setHeader(key, value)
  }
  const cookies = response.headers.getSetCookie?.()
  if (cookies && cookies.length) res.setHeader('set-cookie', cookies)

  if (!response.body) {
    res.end()
    return
  }
  const body = Readable.fromWeb(response.body)
  body.on('error', () => res.destroy())
  body.pipe(res)
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

/**
 * 启动 SSR 宿主服务
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 */
export async function startSsrServer({
  port = Number(process.env.APP_PORT || 7610),
  host = '127.0.0.1',
} = {}) {
  const handler = await loadHandler()

  const httpServer = http.createServer(async (req, res) => {
    try {
      const urlPath = (req.url || '/').split('?')[0]
      if (await tryServeStatic(req, res, urlPath)) return

      const { port: boundPort } = httpServer.address() || {}
      const origin = `http://${host}:${boundPort}`
      const request = toWebRequest(req, origin)
      const response = await handler.fetch(request)
      await writeWebResponse(res, response)
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      }
      res.end(`SSR 处理失败: ${err?.message || err}`)
    }
  })

  let actualPort = port
  try {
    await listen(httpServer, port, host)
    actualPort = httpServer.address().port
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      await listen(httpServer, 0, host)
      actualPort = httpServer.address().port
    } else {
      throw err
    }
  }

  const url = `http://${host}:${actualPort}`
  return {
    url,
    port: actualPort,
    close: () =>
      new Promise((resolve) => {
        httpServer.close(() => resolve())
      }),
  }
}
