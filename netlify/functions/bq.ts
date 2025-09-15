import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  try {
    const term = (event.queryStringParameters?.term || '').toString().trim().slice(0, 64)
    if (!term) {
      return { 
        statusCode: 400, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({ error: 'Missing term parameter. Usage: /api/bq?term=search_term' })
      }
    }
    
    // Use the same approach as dev middleware - HTML scraping with JSON-LD parsing
    const htmlUrl = `https://www.diy.com/search?term=${encodeURIComponent(term)}`
    console.log('B&Q HTML URL:', htmlUrl)
    
    const resp = await fetch(htmlUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Referer': 'https://www.diy.com/',
      },
    })
    
    console.log('B&Q HTML response status:', resp.status)
    
    if (!resp.ok) {
      return { 
        statusCode: resp.status, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        },
        body: JSON.stringify({ error: `B&Q HTTP ${resp.status}` })
      }
    }
    
    const html = await resp.text()
    console.log('B&Q HTML response length:', html.length)
    
    // Parse JSON-LD structured data like the dev middleware
    const ldMatches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
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
      } catch (e) {
        console.log('Failed to parse JSON-LD:', e)
      }
    }
    
    console.log('B&Q: Found', docs.length, 'products from JSON-LD')
    
    return { 
      statusCode: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }, 
      body: JSON.stringify({ response: { docs } })
    }
  } catch (e) {
    console.error('B&Q error:', e)
    return { statusCode: 500, body: 'Internal Error' }
  }
}


