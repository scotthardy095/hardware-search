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
    
    // Use the same approach as dev middleware - just return the raw API response
    const apiUrl = `https://www.diy.com/search.data?term=${encodeURIComponent(term)}&_routes=routes%2Fsearch`
    console.log('B&Q API URL:', apiUrl)
    
    const resp = await fetch(apiUrl, {
      headers: {
        'Accept': 'text/x-script,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    })
    
    console.log('B&Q API response status:', resp.status)
    
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
    
    const text = await resp.text()
    console.log('B&Q API response length:', text.length)
    
    // Return the raw response like the dev middleware does
    return { 
      statusCode: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }, 
      body: text 
    }
  } catch (e) {
    console.error('B&Q error:', e)
    return { statusCode: 500, body: 'Internal Error' }
  }
}


