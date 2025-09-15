import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js'
      }
    }
  },
  plugins: [
    react(),
    {
      name: 'dev-apis',
      configureServer(server) {
        server.middlewares.use('/api/bq', async (req, res) => {
          try {
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            
            if (req.method === 'OPTIONS') {
              res.statusCode = 200
              res.end()
              return
            }
            
            if (req.method !== 'GET') { res.statusCode = 405; res.end('Method Not Allowed'); return }
            const url = new URL(req.url || '', 'http://localhost')
            const term = (url.searchParams.get('term') || '').trim().slice(0, 64)
            if (!term) { res.statusCode = 400; res.end('Missing term'); return }
            const apiUrl = `https://www.diy.com/search.data?term=${encodeURIComponent(term)}&_routes=routes%2Fsearch`
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 10000)
            try {
              // Try HTML search first and parse JSON-LD ItemList for robustness
              const htmlResp = await fetch(`https://www.diy.com/search?term=${encodeURIComponent(term)}`, {
                signal: controller.signal,
                headers: {
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  'Referer': 'https://www.diy.com/',
                },
              })
              if (htmlResp.ok) {
                const html = await htmlResp.text()
                const ldMatches = [...html.matchAll(/<script[^>]*type=\"application\/ld\+json\"[^>]*>([\s\S]*?)<\/script>/g)]
                let docs: any[] = []
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
                            url: item.url?.startsWith('http') ? item.url : `https://www.diy.com${item.url || ''}`,
                            imageUrl: Array.isArray(item.image) ? item.image[0] : item.image || null,
                            price,
                          })
                        }
                      }
                    }
                  } catch {}
                }
                if (docs.length > 0) {
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify({ response: { docs } }))
                  return
                }
              }

              // Fallback to the unofficial search.data endpoint text
              const upstream = await fetch(apiUrl, {
                signal: controller.signal,
                headers: {
                  'Accept': 'text/x-script,application/json;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                },
              })
              const text = await upstream.text()
              res.setHeader('Content-Type', 'application/json')
              res.end(text)
            } finally {
              clearTimeout(timeout)
            }
          } catch (e) {
            res.statusCode = 500; res.end('Internal Error')
          }
        })
        server.middlewares.use('/api/screwfix', async (req, res) => {
          try {
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            
            if (req.method === 'OPTIONS') {
              res.statusCode = 200
              res.end()
              return
            }
            
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return
            }

            const url = new URL(req.url || '', 'http://localhost')
            const termRaw = url.searchParams.get('term') || ''
            const term = termRaw
              .replace(/[^\p{L}\p{N}\s\-+]/gu, ' ')
              .trim()
              .slice(0, 64)
            if (!term) {
              res.statusCode = 400
              res.end('Missing term')
              return
            }

            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 8000)
            try {
              const searchPage = `https://www.screwfix.com/search?search=${encodeURIComponent(term)}`
              const htmlResp = await fetch(searchPage, {
                signal: controller.signal,
                headers: {
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  'Referer': 'https://www.screwfix.com/',
                },
              })
              if (!htmlResp.ok) {
                res.statusCode = 502
                res.end('Upstream HTML fetch failed')
                return
              }
              const html = await htmlResp.text()

              // Try to extract buildId from HTML
              let buildId: string | null = null
              const m1 = html.match(/"buildId":"([^"]+)"/)
              if (m1 && m1[1]) buildId = m1[1]
              if (!buildId) {
                const m2 = html.match(/<script id=\"__NEXT_DATA__\"[^>]*>([\s\S]*?)<\/script>/)
                if (m2 && m2[1]) {
                  try {
                    const nextData = JSON.parse(m2[1])
                    buildId = nextData?.buildId || null
                  } catch {}
                }
              }
              if (!buildId) {
                res.statusCode = 502
                res.end('Unable to determine buildId')
                return
              }

              const apiUrl = `https://www.screwfix.com/_next/data/${buildId}/en-GB/search.json?search=${encodeURIComponent(term)}`
              const jsonResp = await fetch(apiUrl, {
                signal: controller.signal,
                headers: {
                  'Accept': 'application/json',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  'Referer': searchPage,
                },
              })
              if (!jsonResp.ok) {
                res.statusCode = 502
                res.end('Upstream JSON fetch failed')
                return
              }
              const jsonText = await jsonResp.text()
              try {
                const parsed = JSON.parse(jsonText)
                const redirect = parsed?.pageProps?.__N_REDIRECT
                if (redirect && typeof redirect === 'string') {
                  const urlObj = new URL(redirect)
                  const nextPath = urlObj.pathname.replace(/^\/+/, '')
                  const catDataUrl = `https://www.screwfix.com/_next/data/${buildId}/en-GB/${nextPath}.json`
                  const catResp = await fetch(catDataUrl, {
                    signal: controller.signal,
                    headers: {
                      'Accept': 'application/json,text/plain;q=0.9,*/*;q=0.8',
                      'Accept-Language': 'en-GB,en;q=0.9',
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                      'Referer': searchPage,
                    },
                  })
                  const catText = await catResp.text()
                  res.setHeader('Content-Type', 'application/json')
                  res.end(catText)
                  return
                }
              } catch {}
              res.setHeader('Content-Type', 'application/json')
              res.end(jsonText)
            } finally {
              clearTimeout(timeout)
            }
          } catch (err) {
            res.statusCode = 500
            res.end('Internal Error')
          }
        })

        server.middlewares.use('/api/toolstation', async (req, res) => {
          try {
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            
            if (req.method === 'OPTIONS') {
              res.statusCode = 200
              res.end()
              return
            }
            
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return
            }

            const url = new URL(req.url || '', 'http://localhost')
            const termRaw = url.searchParams.get('term') || ''
            const term = termRaw
              .replace(/[^\p{L}\p{N}\s\-+]/gu, ' ')
              .trim()
              .slice(0, 64)
            if (!term) {
              res.statusCode = 400
              res.end('Missing term')
              return
            }

            console.log('Toolstation dev search for:', term)
            const controller = new AbortController()
            const timeout = setTimeout(() => controller.abort(), 20000)
            
            try {
              // Helper functions from Netlify function
              const getSetCookies = (headers: Headers): string[] => {
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

              const mergeCookies = (existing: string | null, setCookies: string[]): string => {
                const jar = new Map<string, string>()
                if (existing) existing.split('; ').forEach(p => { const [k, v] = p.split('='); if (k) jar.set(k, v ?? '') })
                setCookies.forEach(sc => { const [nameVal] = sc.split(';'); const [k, v] = nameVal.split('='); if (k) jar.set(k, v ?? '') })
                return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
              }

              // Step 1: Get homepage to establish session
              console.log('Step 1: Getting homepage...')
              const homeResp = await fetch('https://www.toolstation.com/', {
                signal: controller.signal,
                headers: {
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                },
              })
              
              let cookies = getSetCookies(homeResp.headers)
              let cookieHeader = mergeCookies(null, cookies)
              let token: string | null = null
              cookies.forEach(sc => { const m = sc.match(/ecomApiAccessToken=([^;]+)/); if (m) token = m[1] })
              console.log('Homepage token found:', !!token)

              // Step 2: Get search page to refresh token if needed
              if (!token) {
                console.log('Step 2: Getting search page for token...')
                const searchResp = await fetch(`https://www.toolstation.com/search?q=${encodeURIComponent(term)}`, {
                  signal: controller.signal,
                  headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-GB,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
                  },
                })
                const more = getSetCookies(searchResp.headers)
                cookieHeader = mergeCookies(cookieHeader, more)
                more.forEach(sc => { const m = sc.match(/ecomApiAccessToken=([^;]+)/); if (m) token = m[1] })
                console.log('Search page token found:', !!token)
              }

              if (!token) {
                console.log('No token found, falling back to HTML parsing')
                // Fallback to HTML parsing if no token
                const searchResp = await fetch(`https://www.toolstation.com/search?q=${encodeURIComponent(term)}`, {
                  signal: controller.signal,
                  headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-GB,en;q=0.9',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                    ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
                  },
                })
                
                await searchResp.text()
                const bodyObj = { response: { docs: [] } }
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(bodyObj))
                return
              }

              // Step 3: Call the API with proper authentication
              console.log('Step 3: Calling Toolstation API...')
              const apiUrl = new URL('https://www.toolstation.com/api/search/crs')
              apiUrl.searchParams.set('request_id', String(Date.now()))
              apiUrl.searchParams.set('domain_key', 'toolstation')
              apiUrl.searchParams.set('view_id', 'gb')
              apiUrl.searchParams.set('request_type', 'search')
              apiUrl.searchParams.set('stats_field', 'price,channel')
              apiUrl.searchParams.set('f.category.facet.prefix', '/root,Home/')
              apiUrl.searchParams.set('q', term)
              apiUrl.searchParams.set('rows', '24')
              apiUrl.searchParams.set('start', '0')
              apiUrl.searchParams.set('groupby', 'variant_group')
              apiUrl.searchParams.set('fl', 'pid,slug,numberofreviews,title,brand,sale_price,promotion,thumb_image,sku_thumb_images,sku_swatch_images,sku_color_group,url,priceRange,description,formattedPrices,prices,ts_reviews,assettr,name_type,name_qty,variations,price,samedaydelivery,quantitymaximum,quantityminimum,quantitylabel,channel,group_title,sku_count,sku_group_price_range,sku_group_price_range_ex_vat,campaign')
              apiUrl.searchParams.set('url', 'https://www.toolstation.com')
              apiUrl.searchParams.set('ref_url', 'https://www.google.com/')

              const apiResp = await fetch(apiUrl.toString(), {
                signal: controller.signal,
                headers: {
                  'Accept': 'application/json',
                  'Accept-Language': 'en-GB,en;q=0.9',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                  'Referer': `https://www.toolstation.com/search?q=${encodeURIComponent(term)}`,
                  'Authorization': `Bearer ${token}`,
                  ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
                },
              })

              if (apiResp.ok) {
                console.log('API call successful')
                const jsonText = await apiResp.text()
                res.setHeader('Content-Type', 'application/json')
                res.end(jsonText)
                return
              } else {
                console.log('API call failed:', apiResp.status)
                const bodyObj = { response: { docs: [] } }
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(bodyObj))
                return
              }
              
            } finally {
              clearTimeout(timeout)
            }
          } catch (err) {
            console.error('Toolstation dev error:', err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ response: { docs: [] } }))
          }
        })

        // Add image proxy middleware for dev
        server.middlewares.use('/api/image-proxy', async (req, res) => {
          try {
            // Add CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*')
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
            
            if (req.method === 'OPTIONS') {
              res.statusCode = 200
              res.end()
              return
            }
            
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return
            }

            const url = new URL(req.url || '', 'http://localhost')
            let raw = (url.searchParams.get('url') || '').toString()
            if (!raw) {
              res.statusCode = 400
              res.end('Missing url')
              return
            }
            
            try { raw = decodeURIComponent(raw) } catch {}
            raw = raw.replace(/&amp;/g, '&')
            let target: URL
            try { target = new URL(raw) } catch { 
              res.statusCode = 400
              res.end('Invalid url')
              return
            }

            const allowed = [
              'assets.diy.com', 'www.diy.com', 'media.diy.com',
              'images.diy.com', 'img.diy.com',
              's7g10.scene7.com', 's7g1.scene7.com', 'scene7.com',
              'www.toolstation.com', 'images.toolstation.com'
            ]
            if (!allowed.some(h => target.hostname === h || target.hostname.endsWith(`.${h}`))) {
              res.statusCode = 403
              res.end('Host not allowed')
              return
            }

            const upstreamUrl = target.toString()
            const resp = await fetch(upstreamUrl, {
              headers: {
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Referer': 'https://www.diy.com/',
              },
            })
            
            if (!resp.ok) {
              res.statusCode = resp.status
              res.setHeader('Content-Type', 'text/plain')
              res.end('Upstream error')
              return
            }
            
            const contentType = resp.headers.get('content-type') || 'image/jpeg'
            const buffer = await resp.arrayBuffer()
            res.setHeader('Content-Type', contentType)
            res.setHeader('Cache-Control', 'public, max-age=86400')
            res.end(Buffer.from(buffer))
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'text/plain')
            res.end('Internal Error')
          }
        })
      },
    },
  ],
  server: {
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
})
