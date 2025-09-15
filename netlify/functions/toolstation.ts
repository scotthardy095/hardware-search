import type { Handler } from '@netlify/functions'

type Session = { token: string; cookieHeader: string; expiresAt: number }
let cachedSession: Session | null = null

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

function getSetCookies(headers: Headers): string[] {
  const anyH = headers as any
  try {
    if (typeof anyH.raw === 'function') {
      const raw = anyH.raw()
      const list = raw && raw['set-cookie']
      if (Array.isArray(list)) return list
    }
    if (typeof anyH.getSetCookie === 'function') {
      return (anyH.getSetCookie() as string[]) || []
    }
  } catch {}
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

function mergeCookies(existing: string | null, setCookies: string[]): string {
  const jar = new Map<string, string>()
  if (existing) existing.split('; ').forEach(p => { const [k, v] = p.split('='); if (k) jar.set(k, v ?? '') })
  setCookies.forEach(sc => { const [nameVal] = sc.split(';'); const [k, v] = nameVal.split('='); if (k) jar.set(k, v ?? '') })
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

function jwtExpiryMs(token: string): number | null {
  try {
    const [, payload] = token.split('.')
    const json = JSON.parse(Buffer.from(payload, 'base64').toString())
    if (json?.exp) return json.exp * 1000
  } catch {}
  return null
}

function uuidv4(): string {
  // Simple UUID v4 generator sufficient for ts_visitor_id
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function warmSession(term: string, force = false): Promise<Session> {
  if (!force && cachedSession && cachedSession.expiresAt > Date.now() + 60_000) return cachedSession
  // 1) homepage
  const home = await fetch('https://www.toolstation.com/', {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
      'User-Agent': BROWSER_UA,
    },
  })
  let cookies = getSetCookies(home.headers)
  let cookieHeader = mergeCookies(null, cookies)
  let token: string | null = null
  cookies.forEach(sc => { const m = sc.match(/ecomApiAccessToken=([^;]+)/); if (m) token = m[1] })

  // 2) search page, often sets/refreshes token
  if (!token) {
    const html = await fetch(`https://www.toolstation.com/search?q=${encodeURIComponent(term || 'a')}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': BROWSER_UA,
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    })
    const more = getSetCookies(html.headers)
    cookieHeader = mergeCookies(cookieHeader, more)
    more.forEach(sc => { const m = sc.match(/ecomApiAccessToken=([^;]+)/); if (m) token = m[1] })
  }

  if (!token) throw new Error('Toolstation: token not obtained')
  const exp = jwtExpiryMs(token) ?? (Date.now() + 45 * 60_000)
  cachedSession = { token, cookieHeader, expiresAt: exp }
  return cachedSession
}

async function callSearch(term: string, session: Session): Promise<Response> {
  const apiUrl = new URL('https://www.toolstation.com/api/search/crs')
  apiUrl.searchParams.set('request_id', String(Date.now()))
  apiUrl.searchParams.set('domain_key', 'toolstation')
  apiUrl.searchParams.set('view_id', 'gb')
  apiUrl.searchParams.set('request_type', 'search')
  apiUrl.searchParams.set('stats_field', 'price,channel')
  apiUrl.searchParams.set('f.category.facet.prefix', '/root,Home/')
  apiUrl.searchParams.set('q', term)
  // important fields list, mirrors browser request
  apiUrl.searchParams.set('fl', 'pid,slug,numberofreviews,title,brand,sale_price,promotion,thumb_image,sku_thumb_images,sku_swatch_images,sku_color_group,url,priceRange,description,formattedPrices,prices,ts_reviews,assettr,name_type,name_qty,variations,price,samedaydelivery,quantitymaximum,quantityminimum,quantitylabel,channel,group_title,sku_count,sku_group_price_range,sku_group_price_range_ex_vat,campaign')
  apiUrl.searchParams.set('rows', '24')
  apiUrl.searchParams.set('start', '0')
  apiUrl.searchParams.set('url', 'https://www.toolstation.com')
  apiUrl.searchParams.set('ref_url', 'https://www.google.com/')
  apiUrl.searchParams.set('search_type', 'keyword')
  apiUrl.searchParams.set('skipCache', 'true')
  apiUrl.searchParams.set('ts_visitor_id', uuidv4())
  apiUrl.searchParams.set('groupby', 'variant_group')

  // First try GET with query params
  const getResp = await fetch(apiUrl.toString(), {
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://www.toolstation.com',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': BROWSER_UA,
      'Referer': `https://www.toolstation.com/search?q=${encodeURIComponent(term)}`,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Authorization': `Bearer ${session.token}`,
      'Cookie': session.cookieHeader,
    },
  })
  if (getResp.status !== 400) return getResp

  // Some deployments require POST form-encoded
  const form = new URLSearchParams()
  form.set('request_id', String(Date.now()))
  form.set('domain_key', 'toolstation')
  form.set('view_id', 'gb')
  form.set('request_type', 'search')
  form.set('stats_field', 'price,channel')
  form.set('f.category.facet.prefix', '/root,Home/')
  form.set('q', term)
  form.set('rows', '24')
  form.set('start', '0')
  form.set('groupby', 'variant_group')

  return fetch('https://www.toolstation.com/api/search/crs', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': 'https://www.toolstation.com',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept-Language': 'en-GB,en;q=0.9',
      'User-Agent': BROWSER_UA,
      'Referer': `https://www.toolstation.com/search?q=${encodeURIComponent(term)}`,
      'Authorization': `Bearer ${session.token}`,
      'Cookie': session.cookieHeader,
    },
    body: form.toString(),
  })
}

export const handler: Handler = async (event) => {
  try {
    const term = (event.queryStringParameters?.term || '').toString().trim().slice(0, 64)
    if (!term) return { statusCode: 400, body: 'Missing term' }
    const debugEnabled = event.queryStringParameters?.debug === '1'
    const dbg: Record<string, any> = { term }

    // Try API path with session. If session fails, fall back to HTML parsing.
    try {
      let session = await warmSession(term, false)
      dbg.sessionWarm1 = { hasToken: !!session.token, cookieLen: session.cookieHeader?.length ?? 0, expMs: session.expiresAt - Date.now() }
      let resp = await callSearch(term, session)
      dbg.apiAttempt1 = { status: resp.status }
      if (resp.status === 401 || resp.status === 403) {
        session = await warmSession(term, true)
        dbg.sessionWarm2 = { hasToken: !!session.token, cookieLen: session.cookieHeader?.length ?? 0, expMs: session.expiresAt - Date.now() }
        resp = await callSearch(term, session)
        dbg.apiAttempt2 = { status: resp.status }
      }
      if (resp.ok) {
        const text = await resp.text()
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text }
      }
      if (debugEnabled) {
        try { dbg.apiBody = await resp.text() } catch {}
      }
    } catch {}

    // Fallback: parse JSON-LD from HTML
    const htmlResp = await fetch(`https://www.toolstation.com/search?q=${encodeURIComponent(term)}`, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': BROWSER_UA,
      },
    })
    dbg.htmlStatus = htmlResp.status
    const htmlText = await htmlResp.text()
    const ldMatches = [...htmlText.matchAll(/<script[^>]*type=\"application\/ld\+json\"[^>]*>([\s\S]*?)<\/script>/g)]
    dbg.ldBlocks = ldMatches.length
    const docs: any[] = []
    for (const m of ldMatches) {
      try {
        const json = JSON.parse(m[1])
        if (json['@type'] === 'ItemList' && Array.isArray(json.itemListElement)) {
          for (const el of json.itemListElement) {
            const item = el?.item || el
            if (item && item['@type'] === 'Product') {
              const price = item?.offers?.price ? Number(item.offers.price) : null
              docs.push({
                title: item.name,
                url: item.url?.startsWith('http') ? item.url : `https://www.toolstation.com${item.url || ''}`,
                thumb_image: Array.isArray(item.image) ? item.image[0] : item.image || null,
                price,
                sale_price: price,
              })
            }
          }
        }
      } catch {}
    }
    // Extra anchor-based heuristic if no JSON-LD found
    if (docs.length === 0) {
      // Broader anchor scan for any product detail page containing '/p/'
      const re = /<a[^>]*href=\"([^\"]+?)\"[^>]*>([\s\S]{0,300}?)<\/a>/ig
      let m: RegExpExecArray | null
      while ((m = re.exec(htmlText)) !== null) {
        const href = m[1]
        if (href.includes('/p/') && !href.includes('/help') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
          const rel = href.startsWith('http') ? href : `https://www.toolstation.com${href}`
          const title = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || 'Top result'
          // Try to find a price near the anchor
          const start = Math.max(0, m.index - 400)
          const end = Math.min(htmlText.length, m.index + m[0].length + 400)
          const window = htmlText.slice(start, end)
          const pm = window.match(/£\s*([0-9]+(?:\.[0-9]{1,2})?)/)
          const price = pm ? Number(pm[1]) : null
          docs.push({ title, url: rel, thumb_image: null, price, sale_price: price })
          break
        }
      }
    }
    if (debugEnabled) dbg.docs = docs.slice(0, 2)
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ response: { docs }, debug: debugEnabled ? dbg : undefined }) }
  } catch (e: any) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'internal', message: e?.message || 'Unknown error' }) }
  }
}


