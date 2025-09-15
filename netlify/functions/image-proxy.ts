import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  try {
    let raw = (event.queryStringParameters?.url || '').toString()
    if (!raw) return { statusCode: 400, body: 'Missing url' }
    try { raw = decodeURIComponent(raw) } catch {}
    // Fix common HTML entity encoding in query
    raw = raw.replace(/&amp;/g, '&')
    let target: URL
    try { target = new URL(raw) } catch { return { statusCode: 400, body: 'Invalid url' } }

    const allowed = [
      'assets.diy.com', 'www.diy.com', 'media.diy.com',
      'images.diy.com', 'img.diy.com',
      's7g10.scene7.com', 's7g1.scene7.com', 'scene7.com'
    ]
    if (!allowed.some(h => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
      return { statusCode: 403, body: 'Host not allowed' }
    }

    // Sanitize B&Q Scene7 style URLs
    try {
      if ((target.hostname === 'assets.diy.com' || target.hostname.endsWith('.diy.com')) && target.pathname.startsWith('/is/image/')) {
        // Remove Scene7 macros and ensure explicit params
        const original = target.search
        const sp = new URLSearchParams(original.startsWith('?') ? original.slice(1) : original)
        for (const key of Array.from(sp.keys())) { if (key.startsWith('$')) sp.delete(key) }
        const wid = sp.get('wid') || '300'
        const hei = sp.get('hei') || '300'
        sp.set('wid', wid)
        sp.set('hei', hei)
        if (!sp.has('fmt')) sp.set('fmt', 'jpg')
        if (!sp.has('qlt')) sp.set('qlt', '80')
        target.search = `?${sp.toString()}`
      }
    } catch {}

    const upstreamUrl = target.toString()
    const resp = await fetch(upstreamUrl, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://www.diy.com/',
      },
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      const headers: Record<string, string> = { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Proxy-Url': upstreamUrl }
      return { statusCode: resp.status, headers, body: text || 'Upstream error' }
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg'
    const buf = Buffer.from(await resp.arrayBuffer())
    const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400', 'X-Proxy-Url': upstreamUrl }
    return { statusCode: 200, headers, body: buf.toString('base64'), isBase64Encoded: true }
  } catch (e) {
    const headers: Record<string, string> = { 'Content-Type': 'text/plain' }
    return { statusCode: 500, headers, body: 'Internal Error' }
  }
}


