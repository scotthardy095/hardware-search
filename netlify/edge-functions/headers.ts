import type { Context } from "https://edge.netlify.com";

export default async function handler(request: Request, context: Context) {
  const url = new URL(request.url);
  
  // Get the original response first
  const response = await context.next();
  
  // Create new response with original content but modified headers
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
  
  // Set correct MIME types based on file extension
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.mjs')) {
    newResponse.headers.set('Content-Type', 'application/javascript; charset=utf-8');
    newResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (url.pathname.endsWith('.css')) {
    newResponse.headers.set('Content-Type', 'text/css; charset=utf-8');
    newResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (url.pathname.endsWith('.svg')) {
    newResponse.headers.set('Content-Type', 'image/svg+xml; charset=utf-8');
    newResponse.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (url.pathname.endsWith('.html') || url.pathname === '/') {
    newResponse.headers.set('Content-Type', 'text/html; charset=utf-8');
    newResponse.headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  
  return newResponse;
}