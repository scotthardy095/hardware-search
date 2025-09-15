export function getApiUrl(endpoint: 'bq' | 'screwfix' | 'toolstation' | 'image-proxy'): string {
  if (import.meta.env.DEV) {
    return `/api/${endpoint}`
  }
  return `/.netlify/functions/${endpoint}`
}


