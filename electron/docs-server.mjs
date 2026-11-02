/**
 * 内置文档站静态服务
 *
 * 打包后 picop-docs 的 dumi 构建产物随应用分发（resources/app/docs-site），
 * 启动后托管在 127.0.0.1:4000，供侧边栏「文档」菜单直接打开，无需本地起 docs dev server。
 *
 * 约定：
 *   - 请求路径映射到 docs-site 下的真实文件（dumi 构建已为每个路由生成 index.html）
 *   - 目录请求补 index.html
 *   - 未命中时回退 404.html
 *   - 端口被占用（例如本地正跑着 dumi dev）则直接跳过，沿用已有服务
 */

import http from 'node:http'
import { createReadStream, existsSync } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { DOCS_DIR } from './paths.mjs'

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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

/** 将 URL 路径解析为 docs-site 下的真实文件，找不到返回 null */
async function resolveFile(urlPath) {
  let decoded
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }

  let rel = decoded.replace(/^\/+/, '')
  if (rel === '' || rel.endsWith('/')) rel += 'index.html'

  const filePath = path.resolve(DOCS_DIR, rel)
  if (filePath !== DOCS_DIR && !filePath.startsWith(DOCS_DIR + path.sep)) {
    return null
  }

  try {
    const stat = await fsp.stat(filePath)
    if (stat.isFile()) return filePath
    if (stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html')
      if ((await fsp.stat(indexFile)).isFile()) return indexFile
    }
  } catch {
    // 落到 404 回退
  }
  return null
}

/**
 * 启动内置文档站服务
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> } | null>}
 */
export async function startDocsServer({
  port = Number(process.env.DOCS_PORT || 4000),
  host = '127.0.0.1',
} = {}) {
  if (!existsSync(DOCS_DIR)) {
    console.warn('[docs] 未找到内置文档产物，跳过文档站启动:', DOCS_DIR)
    return null
  }

  const fallback404 = path.join(DOCS_DIR, '404.html')

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405
      res.end('Method Not Allowed')
      return
    }

    const urlPath = (req.url || '/').split('?')[0]
    const filePath = (await resolveFile(urlPath)) || fallback404

    try {
      const stat = await fsp.stat(filePath)
      res.statusCode = filePath === fallback404 ? 404 : 200
      res.setHeader('Content-Type', contentType(filePath))
      res.setHeader('Content-Length', stat.size)
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      createReadStream(filePath)
        .on('error', () => res.destroy())
        .pipe(res)
    } catch {
      res.statusCode = 404
      res.end('Not Found')
    }
  })

  const started = await new Promise((resolve) => {
    server.once('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        console.warn(
          `[docs] 端口 ${port} 已被占用，沿用已有文档服务（如本地 dumi dev）`,
        )
        resolve(false)
      } else {
        console.error('[docs] 文档站启动失败:', err?.message || err)
        resolve(false)
      }
    })
    server.listen(port, host, () => resolve(true))
  })

  if (!started) return null

  const actualPort = server.address().port
  const url = `http://${host}:${actualPort}`
  console.log('[docs] 内置文档站已启动:', url)

  return {
    url,
    port: actualPort,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}
