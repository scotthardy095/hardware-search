import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  try {
    const term = (event.queryStringParameters?.term || '').toString().trim().slice(0, 64)
    if (!term) return { statusCode: 400, body: 'Missing term' }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    try {
      const searchPage = `https://www.screwfix.com/search?search=${encodeURIComponent(term)}`
      const htmlResp = await fetch(searchPage, {
        signal: controller.signal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        },
      })
      const html = await htmlResp.text()

      let buildId: string | null = null
      const m1 = html.match(/"buildId":"([^"]+)"/)
      if (m1 && m1[1]) buildId = m1[1]
      if (!buildId) {
        const m2 = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
        if (m2 && m2[1]) {
          try { buildId = JSON.parse(m2[1])?.buildId || null } catch {}
        }
      }
      if (!buildId) return { statusCode: 502, body: 'Unable to determine buildId' }

      const apiUrl = `https://www.screwfix.com/_next/data/${buildId}/en-GB/search.json?search=${encodeURIComponent(term)}`
      const jsonResp = await fetch(apiUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': `https://www.screwfix.com/search?search=${encodeURIComponent(term)}`,
        },
      })
      const jsonText = await jsonResp.text()
      try {
        const parsed = JSON.parse(jsonText)
        const redirect = parsed?.pageProps?.__N_REDIRECT
        if (redirect && typeof redirect === 'string') {
          // Follow redirect to category/product listing using the Next.js data API form
          const urlObj = new URL(redirect)
          const nextPath = urlObj.pathname.replace(/^\/+/, '')
          const catDataUrl = `https://www.screwfix.com/_next/data/${buildId}/en-GB/${nextPath}.json`
          const catResp = await fetch(catDataUrl, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-GB,en;q=0.9',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': `https://www.screwfix.com/search?search=${encodeURIComponent(term)}`,
            },
          })
          const catText = await catResp.text()
          return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: catText }
        }
      } catch {
        // ignore JSON parse errors; fall through to return original text
      }
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: jsonText }
    } finally {
      clearTimeout(timeout)
    }
  } catch (e) {
    return { statusCode: 500, body: 'Internal Error' }
  }
}


