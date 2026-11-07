/** API base from VITE_API_URL (default http://localhost:8000); ws URL is derived from it. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
export const WS_URL: string = API_URL.replace(/^http/, 'ws')
