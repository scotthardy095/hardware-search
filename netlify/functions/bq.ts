import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  try {
    const term = (event.queryStringParameters?.term || '').toString().trim().slice(0, 64)
    if (!term) {
      return { statusCode: 400, body: 'Missing term' }
    }
    const url = `https://www.diy.com/search.data?term=${encodeURIComponent(term)}&_routes=routes%2Fsearch`
    const resp = await fetch(url, {
      headers: {
        'Accept': 'text/x-script,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'merrick-search/1.0',
      },
    })
    const text = await resp.text()
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: text }
  } catch (e) {
    return { statusCode: 500, body: 'Internal Error' }
  }
}


