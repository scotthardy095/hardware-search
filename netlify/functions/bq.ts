import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  try {
    const term = (event.queryStringParameters?.term || '').toString().trim().slice(0, 64)
    if (!term) {
      return { statusCode: 400, body: 'Missing term' }
    }
    
    // Try different B&Q API endpoints
    const endpoints = [
      `https://www.diy.com/search.data?term=${encodeURIComponent(term)}&_routes=routes%2Fsearch`,
      `https://www.diy.com/api/search?term=${encodeURIComponent(term)}`,
      `https://www.diy.com/search.json?term=${encodeURIComponent(term)}`
    ]
    
    for (const apiUrl of endpoints) {
      try {
        console.log('Trying B&Q API:', apiUrl)
        const resp = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/json,text/x-script,application/json;q=0.9,*/*;q=0.8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Referer': 'https://www.diy.com/',
            'Accept-Language': 'en-GB,en;q=0.9',
            'Cache-Control': 'no-cache',
          },
        })
        
        console.log('B&Q API response status:', resp.status)
        
        if (resp.ok) {
          const text = await resp.text()
          console.log('B&Q API response length:', text.length)
          console.log('B&Q API response preview:', text.substring(0, 200))
          
          // Check if we got a maintenance page
          if (text.includes('Sorry, our techies are currently working on diy.com') || 
              text.includes('We know you\'re keen to get on with your home improvement project')) {
            console.log('B&Q maintenance page detected, trying next endpoint')
            continue
          }
          
          // Check if we got valid JSON
          try {
            const json = JSON.parse(text)
            console.log('B&Q API returned valid JSON')
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
          } catch (jsonError) {
            console.log('B&Q API response is not JSON, trying next endpoint')
            continue
          }
        } else {
          console.log('B&Q API returned error status:', resp.status)
        }
      } catch (fetchError) {
        console.log('B&Q API fetch error:', fetchError)
        continue
      }
    }
    
    // If all API endpoints fail, return empty results
    console.log('All B&Q API endpoints failed')
    return { 
      statusCode: 200, 
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }, 
      body: JSON.stringify({ response: { docs: [] } }) 
    }
  } catch (e) {
    console.error('B&Q error:', e)
    return { statusCode: 500, body: 'Internal Error' }
  }
}


