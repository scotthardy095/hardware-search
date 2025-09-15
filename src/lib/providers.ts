export type Retailer = 'B&Q' | 'Screwfix' | 'Toolstation'
import { getApiUrl } from './api'

export type ProviderResult = {
  retailer: Retailer
  title: string
  price: number | null
  url: string | null
  imageUrl: string | null
}

export async function searchAllProviders(query: string, limitPerRetailer: number = 3): Promise<ProviderResult[]> {
  const [bq, screwfix, toolstation] = await Promise.all([
    searchBQMany(query, limitPerRetailer).catch(() => []),
    searchScrewfixMany(query, limitPerRetailer).catch(() => []),
    searchToolstationMany(query, limitPerRetailer).catch(() => []),
  ])

  return [...bq, ...screwfix, ...toolstation]
}

export async function searchSingleProvider(retailer: Retailer, query: string, limit: number): Promise<ProviderResult[]> {
  switch (retailer) {
    case 'B&Q':
      return searchBQMany(query, limit).catch(() => [])
    case 'Screwfix':
      return searchScrewfixMany(query, limit).catch(() => [])
    case 'Toolstation':
      return searchToolstationMany(query, limit).catch(() => [])
    default:
      return []
  }
}

async function searchBQMany(query: string, limit: number): Promise<ProviderResult[]> {
  const url = `${getApiUrl('bq')}?term=${encodeURIComponent(query)}&_routes=routes%2Fsearch`
  const res = await fetch(url, { headers: { 'Accept': 'text/plain' } })
  if (!res.ok) throw new Error(`B&Q HTTP ${res.status}`)
  const text = await res.text()

  // First try if middleware returned normalized docs
  try {
    const parsed = JSON.parse(text)
    const docs = parsed?.response?.docs
    if (Array.isArray(docs) && docs.length > 0) {
      return docs.slice(0, limit).map((p: any) => {
        let rawImg = p.imageUrl || p.image || p.thumbnail || null
        if (!rawImg) rawImg = findAnyImageUrl(p)
        const normImg = proxyIfNeeded(normalizeBqImageUrl(rawImg))
        return {
          retailer: 'B&Q' as Retailer,
          title: p.title || p.name || 'Top result',
          price: typeof p.price === 'number' ? p.price : null,
          url: typeof p.url === 'string' ? ensureAbsolute(p.url, 'https://www.diy.com') : null,
          imageUrl: normImg,
        }
      })
    }
  } catch {}

  // Fallback: extract JSON substring from text/x-script response
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) throw new Error('B&Q: no JSON detected')
  const jsonStr = text.slice(first, last + 1)
  let data: any
  try { data = JSON.parse(jsonStr) } catch { throw new Error('B&Q: parse error') }

  const arrays: any[] = []
  function collectArrays(node: any) {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) arrays.push(node)
    else Object.values(node).forEach(collectArrays)
  }
  collectArrays(data)
  const candidates: any[] = []
  for (const arr of arrays) {
    const items = arr.filter((x: any) => x && (x.productUrl || x.url) && (x.title || x.name))
    if (items.length >= 1) candidates.push(...items)
  }
  const picked = (candidates.length ? candidates : [deepFindFirstProduct(data, ['productUrl', 'title'], ['url', 'name'])].filter(Boolean)).slice(0, limit)
  return picked.map((p: any) => {
    const priceRaw = p?.price?.value ?? p?.price ?? p?.priceValue
    let rawImg = p?.image || p?.imageUrl || p?.thumbnail || null
    if (!rawImg) rawImg = findAnyImageUrl(p)
    const image = proxyIfNeeded(normalizeBqImageUrl(rawImg))
    const productUrl = p?.productUrl || p?.url || null
    const price = typeof priceRaw === 'number' ? priceRaw : (() => {
      const m = typeof priceRaw === 'string' ? priceRaw.match(/[0-9]+(\.[0-9]{1,2})?/) : null
      return m ? parseFloat(m[0]) : null
    })()
    return {
      retailer: 'B&Q' as Retailer,
      title: p.title || p.name || 'Top result',
      price: Number.isFinite(price as number) ? (price as number) : null,
      url: productUrl ? ensureAbsolute(productUrl, 'https://www.diy.com') : null,
      imageUrl: image ?? null,
    }
  })
}

async function searchScrewfixMany(query: string, limit: number): Promise<ProviderResult[]> {
  const params = new URLSearchParams({ term: query })
  const res = await fetch(`${getApiUrl('screwfix')}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Screwfix HTTP ${res.status}`)
  const data: any = await res.json()
  const productsPath = data?.pageProps?.pageData?.products
  let list: any[] = Array.isArray(productsPath) && productsPath.length > 0 ? productsPath : []
  if (list.length < 3) {
    // Try common alternative paths
    const alt1 = data?.pageProps?.pageData?.results?.products
    const alt2 = data?.pageProps?.results?.products
    const alt3 = data?.results?.products
    const alt4 = data?.pageProps?.pageData?.category?.products
    const alt5 = data?.pageProps?.category?.products
    const alt6 = data?.category?.products
    const merged: any[] = []
    for (const candidate of [alt1, alt2, alt3, alt4, alt5, alt6]) {
      if (Array.isArray(candidate)) merged.push(...candidate)
    }
    list = [...list, ...merged]
  }
  if (list.length < 3) {
    // Fallback: collect any objects that look like products
    const collected = collectScrewfixProducts(data)
    const deduped: any[] = []
    const seen = new Set<string>()
    for (const p of collected) {
      const key = p?.skuId || p?.detailPageUrl || p?.longDescription || JSON.stringify(p)
      if (!seen.has(key)) { seen.add(key); deduped.push(p) }
      if (deduped.length >= Math.max(50, limit)) break
    }
    list = list.concat(deduped)
  }
  const final = list.filter(Boolean).slice(0, Math.max(limit, 50))
  if (final.length === 0) {
    return [
      {
        retailer: 'Screwfix' as Retailer,
        title: `Open Screwfix results for "${query}"`,
        price: null,
        url: `https://www.screwfix.com/search?search=${encodeURIComponent(query)}`,
        imageUrl: null,
      },
    ]
  }
  return final.map((p: any) => {
    const amount = p?.priceInformation?.currentPriceIncVat?.amount ?? p?.priceInformation?.currentPriceExVat?.amount
    return {
      retailer: 'Screwfix' as Retailer,
      title: p.longDescription || p.name || 'Top result',
      price: typeof amount === 'number' ? amount : null,
      url: p.detailPageUrl ? `https://www.screwfix.com${p.detailPageUrl}` : null,
      imageUrl: p.imageUrl || null,
    }
  })
}

async function searchToolstationMany(query: string, limit: number): Promise<ProviderResult[]> {
  const params = new URLSearchParams({ term: query })
  const res = await fetch(`${getApiUrl('toolstation')}?${params.toString()}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Toolstation HTTP ${res.status}`)
  const data: any = await res.json()
  const docs = data?.response?.docs || []
  if (!Array.isArray(docs) || docs.length === 0) {
    return [
      {
        retailer: 'Toolstation' as Retailer,
        title: `Open Toolstation results for "${query}"`,
        price: null,
        url: `https://www.toolstation.com/search?q=${encodeURIComponent(query)}`,
        imageUrl: null,
      },
    ]
  }
  return docs.slice(0, limit).map((d: any) => ({
    retailer: 'Toolstation' as Retailer,
    title: d.title || d.group_title || 'Top result',
    price: typeof d.sale_price === 'number' ? d.sale_price : typeof d.price === 'number' ? d.price : null,
    url: d.url || null,
    imageUrl: d.thumb_image || null,
  }))
}

// Utility: recursively search for a product-like object inside any arrays in the response
function deepFindFirstProduct(root: any, requiredKeys: string[], altKeys: string[] = []): any | null {
  const seen = new Set<any>()
  function visit(node: any): any | null {
    if (!node || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item)
        if (found) return found
      }
      return null
    }
    // If node looks like a product
    const hasRequired = requiredKeys.every((k) => k in node)
    const hasAlt = altKeys.length > 0 && altKeys.some((k) => k in node)
    const hasPrice = 'priceInformation' in node || 'price' in node
    if (hasRequired || (hasAlt && hasPrice)) return node
    // Recurse
    for (const key of Object.keys(node)) {
      const child = (node as any)[key]
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(root)
}

// Helpers
function ensureAbsolute(url: string, origin: string): string {
  try {
    if (!url) return url
    if (/^https?:\/\//i.test(url)) return url
    if (url.startsWith('//')) return `https:${url}`
    if (url.startsWith('/')) return `${origin}${url}`
    return `${origin}/${url}`
  } catch {
    return url
  }
}

function normalizeBqImageUrl(input: any): string | null {
  try {
    let src: any = input
    if (!src) return null
    if (Array.isArray(src)) src = src.find((s) => typeof s === 'string') || src[0]
    if (src && typeof src === 'object') {
      const maybe = src.url || src.src || src.href || src.link || src.image || null
      src = maybe || null
    }
    if (typeof src !== 'string') return null
    src = src.trim()
    // Protocol-relative -> https and possible host rewrite
    if (src.startsWith('//')) {
      let absolute = `https:${src}`
      try {
        const u = new URL(absolute)
        if ((u.hostname === 'www.diy.com' || u.hostname.endsWith('.diy.com')) && u.pathname.startsWith('/is/image/')) {
          // keep original host; only sanitize query
          sanitizeBqIsImageUrl(u)
          absolute = u.toString()
        }
      } catch {}
      return absolute
    }
    // Absolute URL -> rewrite host for B&Q image service if needed
    if (/^https?:\/\//i.test(src)) {
      try {
        const u = new URL(src)
        const isBqImage = (
          u.pathname.startsWith('/is/image/') ||
          u.hostname.includes('scene7.com')
        )
        if (isBqImage) {
          // Do not force a host rewrite; some networks can't resolve assets.diy.com
          sanitizeBqIsImageUrl(u)
          return u.toString()
        }
      } catch {}
      return src
    }
    // Relative path -> choose correct origin
    const origin = src.startsWith('/is/image/') ? 'https://www.diy.com' : 'https://www.diy.com'
    const absolute = `${origin}${src.startsWith('/') ? '' : '/'}${src}`
    try {
      const u = new URL(absolute)
      if ((u.hostname === 'www.diy.com' || u.hostname.endsWith('.diy.com')) && u.pathname.startsWith('/is/image/')) {
        sanitizeBqIsImageUrl(u)
        return u.toString()
      }
    } catch {}
    return absolute
  } catch {
    return null
  }
}

function findAnyImageUrl(node: any, depth = 0, visited = new Set<any>()): string | null {
  try {
    if (depth > 3 || !node || typeof node !== 'object' || visited.has(node)) return null
    visited.add(node)
    // Direct string fields of interest
    const preferredKeys = ['imageUrl', 'image', 'thumbnail', 'thumbnailUrl', 'img', 'uri', 'url']
    for (const key of preferredKeys) {
      const val = (node as any)[key]
      if (typeof val === 'string') {
        const s = val.trim()
        if (/\/(is|media)\/image\//i.test(s) || /\.(png|jpe?g|webp)(\?|$)/i.test(s)) return s
      }
    }
    // Scan all string values
    for (const val of Object.values(node)) {
      if (typeof val === 'string') {
        const s = val.trim()
        if (/\/(is|media)\/image\//i.test(s) || /\.(png|jpe?g|webp)(\?|$)/i.test(s)) return s
      }
    }
    // Recurse arrays and objects
    for (const val of Object.values(node)) {
      if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string') {
            const s = item.trim()
            if (/\/(is|media)\/image\//i.test(s) || /\.(png|jpe?g|webp)(\?|$)/i.test(s)) return s
          } else if (item && typeof item === 'object') {
            const found = findAnyImageUrl(item, depth + 1, visited)
            if (found) return found
          }
        }
      } else if (val && typeof val === 'object') {
        const found = findAnyImageUrl(val, depth + 1, visited)
        if (found) return found
      }
    }
  } catch {}
  return null
}

function proxyIfNeeded(url: string | null): string | null {
  try {
    if (!url) return url
    const u = new URL(url)
    const bqHosts = ['assets.diy.com', 'www.diy.com', 'media.diy.com', 'images.diy.com', 'scene7.com']
    const isBq = bqHosts.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`))
    if (!isBq) return url
    const proxied = `${getApiUrl('image-proxy')}?url=${encodeURIComponent(u.toString())}`
    return proxied
  } catch {
    return url
  }
}

function sanitizeBqIsImageUrl(u: URL) {
  try {
    // Decode HTML entity artifacts
    if (u.search && u.search.includes('&amp;')) {
      u.search = u.search.replace(/&amp;/g, '&')
    }
    // If query contains Scene7 preset/macros like $MOB_PREV$ or $width/$height, strip macros and use explicit params
    const original = u.search
    const sp = new URLSearchParams(original.startsWith('?') ? original.slice(1) : original)
    let wid = sp.get('wid') || sp.get('$width') || ''
    let hei = sp.get('hei') || sp.get('$height') || ''
    // Drop all $macro params
    for (const key of Array.from(sp.keys())) {
      if (key.startsWith('$')) sp.delete(key)
    }
    // Ensure sensible defaults
    if (!wid) wid = '300'
    if (!hei) hei = '300'
    sp.set('wid', wid)
    sp.set('hei', hei)
    if (!sp.has('fmt')) sp.set('fmt', 'jpg')
    if (!sp.has('qlt')) sp.set('qlt', '80')
    // Re-assign
    u.search = `?${sp.toString()}`
  } catch {}
}

function collectScrewfixProducts(root: any): any[] {
  const results: any[] = []
  const seen = new Set<any>()
  function visit(node: any) {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      for (const item of node) visit(item)
      return
    }
    const looksLike = (
      ('detailPageUrl' in node) && (('longDescription' in node) || ('name' in node))
    ) || ('skuId' in node && ('imageUrl' in node || 'priceInformation' in node))
    if (looksLike) results.push(node)
    for (const key of Object.keys(node)) visit((node as any)[key])
  }
  visit(root)
  return results
}


