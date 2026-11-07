#!/usr/bin/env node
// Frame-rate measurement for the ghost swarm (roadmap step 18; reused by step 40).
//
//   npm run measure:fps -- [ghosts] [vsync|uncapped] [quick]
//   npm run measure:fps -- 10000 vsync
//
// It starts the API (with OVERWATCH_GHOSTS=<ghosts>) and Vite itself, opens a real Chrome on the real GPU,
// loads the demo case, and for three camera views (default, wide, close) x trails on/off records every
// animation frame for ~9 s. `vsync` is what a viewer gets (capped at the display rate); `uncapped` lifts the
// cap so you can see the HEADROOM behind a flat "60 fps". `quick` measures only the default view, ~6 s.
//
// Needs: the repo's .venv (pip install -r requirements.txt), `npm ci`, and Chrome. Set CHROME_PATH if
// Chrome is not at the macOS default. Stops anything already listening on :8000 / :5199 first.
import puppeteer from 'puppeteer-core'
import { spawn, execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(FRONTEND, '..')
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const [GHOSTS = '5000', MODE = 'vsync', QUICK] = process.argv.slice(2)
const quick = QUICK === 'quick'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

try { execSync('pkill -f "uvicorn backend.api.main"; pkill -f "vite --port 5199"') } catch { /* nothing running */ }
const api = spawn('bash', ['-c', `cd "${ROOT}" && . .venv/bin/activate && OVERWATCH_GHOSTS=${GHOSTS} exec uvicorn backend.api.main:app --port 8000`], { stdio: 'ignore' })
const vite = spawn('npx', ['vite', '--port', '5199'], { cwd: FRONTEND, stdio: 'ignore' })
await sleep(4500)

const args = ['--no-sandbox', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=metal']
if (MODE === 'uncapped') args.push('--disable-frame-rate-limit', '--disable-gpu-vsync')
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args, defaultViewport: { width: 1440, height: 900 } })

const stat = (d) => {
  const s = [...d].sort((a, b) => a - b)
  const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))]
  return { medianFps: +(1000 / q(0.5)).toFixed(0), low1pctFps: +(1000 / q(0.99)).toFixed(0), worstFrameMs: +s.at(-1).toFixed(1), frames: d.length }
}
const views = quick ? ['default'] : ['default', 'wide', 'close']
const rows = []
const errors = []
for (const trails of [true, false]) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://localhost:5199/' + (trails ? '' : '?trails=0'))
  await page.waitForFunction(() => window.__map && window.__ghosts && window.__perf)
  await sleep(4000)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Load demo case').click())
  await sleep(12000)
  for (const view of views) {
    await page.evaluate((view) => {
      const g = window.__ghosts
      const b = g.buffers[g.cur]
      let sx = 0, sy = 0
      for (let i = 0; i < g.count; i++) { sx += b[4 * i]; sy += b[4 * i + 1] }
      const c = { lng: sx / g.count, lat: sy / g.count }
      const m = window.__map
      if (view === 'default') m.jumpTo({ center: { lng: -113.5337, lat: 53.5422 }, zoom: 14.6, pitch: 55, bearing: -17 })
      if (view === 'wide') m.jumpTo({ center: c, zoom: 12.6, pitch: 45, bearing: 0 })
      if (view === 'close') m.jumpTo({ center: c, zoom: 16.6, pitch: 50, bearing: 0 })
    }, view)
    await sleep(3000) // tiles and terrain load
    await page.evaluate(() => {
      window.__d = []
      window.__on = true
      let last = performance.now()
      const loop = (t) => { if (!window.__on) return; window.__d.push(t - last); last = t; requestAnimationFrame(loop) }
      requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop) })
    })
    await sleep(quick ? 6000 : 9000)
    const r = await page.evaluate(() => { window.__on = false; return { d: window.__d.slice(2), ghosts: window.__ghosts.count, work: +window.__perf.workMs.toFixed(2) } })
    rows.push({ ghosts: r.ghosts, trails: trails ? 'on' : 'off', view, ...stat(r.d), jsWorkMs: r.work })
  }
  await page.close()
}
console.log(`mode=${MODE} ghosts=${GHOSTS} (this machine's GPU; vsync caps at the display rate)`)
console.table(rows)
if (errors.length) console.log('page errors:', errors.slice(0, 4))
await browser.close()
vite.kill()
api.kill()
try { execSync('pkill -f "uvicorn backend.api.main"; pkill -f "vite --port 5199"') } catch { /* already gone */ }
