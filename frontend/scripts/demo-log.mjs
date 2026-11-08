// Runs the demo end to end in real Chrome, several times, and logs everything that happens.
//
//   node scripts/demo-log.mjs --runs 3 --modes builtin,scripted
//
// Each run starts its OWN API on port 8010 (and one Vite on 5198 for the whole script), so your own `make dev`
// servers on 8000 and 5173 are never touched, and a run never sees another run's case. A scripted "officer" drives
// the screen the way a person would (approve the drone, read the cards, confirm, close the search). Everything the
// browser sees is written as timestamped JSON lines: the stream's messages, every HTTP call, every change to the
// screen's state, performance, the camera, the drone feed, console output and errors; plus the API's own log.
//
// Modes:  builtin  = the API's own tips (what `make dev` does)
//         scripted = `make api-live` + the scenario's tips (the screen's demo script) + the drone clue from `emit`
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { buildReport } from './demo-report.mjs'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const FRONT = join(ROOT, 'frontend')
const API_PORT = Number(process.env.OW_API_PORT ?? 8010)
const WEB_PORT = Number(process.env.OW_WEB_PORT ?? 5198)
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PY = join(ROOT, '.venv/bin/python')
const UVICORN = join(ROOT, '.venv/bin/uvicorn')

const args = process.argv.slice(2)
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : dflt }
const RUNS = Number(opt('runs', 3))
const MODES = opt('modes', 'builtin,scripted').split(',')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = resolve(opt('out', join(FRONT, 'demo-logs', STAMP)))
mkdirSync(OUT, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sh = (cmd) => { try { return execFileSync('bash', ['-c', cmd], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' } }

// Never touch anyone else's servers: refuse to start if our ports are taken.
for (const port of [API_PORT, WEB_PORT]) {
  if (sh(`lsof -ti tcp:${port} -sTCP:LISTEN`)) { console.error(`port ${port} is already in use; stop it or set OW_API_PORT / OW_WEB_PORT`); process.exit(2) }
}

const kids = []
const killAll = () => { for (const k of kids) { try { process.kill(-k.pid) } catch { try { k.kill() } catch {} } } }
process.on('exit', killAll)
process.on('SIGINT', () => { killAll(); process.exit(130) })

// ---------------------------------------------------------------- the page-side instrumentation
const INSTRUMENT = `(() => {
  const log = (e) => window.__owLog({ at: Date.now(), ...e })
  const r3 = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : x)
  // every stream message
  const NativeWS = window.WebSocket
  window.WebSocket = class extends NativeWS {
    constructor(url, protocols) {
      super(url, protocols)
      if (!String(url).includes('/stream/')) return // the dev server's own hot-reload socket is not part of the demo
      log({ type: 'ws.connect', url })
      this.addEventListener('open', () => log({ type: 'ws.open', url }))
      this.addEventListener('close', (e) => log({ type: 'ws.close', url, code: e.code, clean: e.wasClean }))
      this.addEventListener('error', () => log({ type: 'ws.error', url }))
      this.addEventListener('message', (ev) => {
        let m
        try { m = JSON.parse(ev.data) } catch { return log({ type: 'ws.unparseable', bytes: String(ev.data).length }) }
        if (m.type === 'ghosts') {
          const d = m.data
          log({ type: 'ws.ghosts', simTime: d.t, n: d.positions.length, respawned: Array.isArray(d.respawned) ? d.respawned.length : null, alive: r3(d.alive_fraction),
            clusters: (d.clusters || []).map((c) => ({ id: c.id, p: r3(c.probability), lat: Math.round(c.center.lat * 1e5) / 1e5, lon: Math.round(c.center.lon * 1e5) / 1e5, evidence: (c.evidence_ids || []).length, story: c.story ? c.story.slice(0, 90) : null })) })
        } else log({ type: 'ws.' + m.type, data: m.data })
      })
    }
  }
  // every HTTP call the screen makes
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    const method = (init && init.method) || 'GET'
    const t0 = Date.now()
    const body = init && typeof init.body === 'string' ? init.body.slice(0, 500) : undefined
    try {
      const res = await nativeFetch(input, init)
      log({ type: 'http', method, url, status: res.status, ms: Date.now() - t0, body })
      return res
    } catch (e) { log({ type: 'http.fail', method, url, error: String(e), aborted: e && e.name === 'AbortError', ms: Date.now() - t0 }); throw e }
  }
  // long frames and long tasks
  let lastRaf = 0
  const raf = (now) => { if (lastRaf && now - lastRaf > 50) log({ type: 'longframe', ms: Math.round(now - lastRaf) }); lastRaf = now; requestAnimationFrame(raf) }
  requestAnimationFrame(raf)
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) log({ type: 'longtask', ms: Math.round(e.duration) }) }).observe({ entryTypes: ['longtask'] }) } catch {}
  // the screen's state, logged when it changes; and samplers for performance, camera and the drone feed
  const start = () => {
    if (!window.__store || !window.__perf) return setTimeout(start, 200)
    const snap = () => {
      const s = window.__store.getState()
      return {
        connection: s.connection && s.connection.state, caseId: s.caseProfile ? s.caseProfile.case_id : null,
        panels: s.ui.panels, replay: s.ui.replay.mode, selected: s.ui.selectedEvidenceId, pipFor: s.ui.pipRequestId, attribution: s.ui.attribution,
        evidence: s.evidence.order.length, requests: s.requests.order.map((id) => (id || '').slice(-5) + ':' + (s.requests.byId[id].asset) + ':' + (s.requests.byId[id].status || 'pending')),
        decisions: Object.keys(s.decisions).length, found: s.found ? s.found.evidence_id : null, foundDismissed: s.foundDismissed, closing: s.closing,
        toasts: s.toasts.map((t) => t.tone + ': ' + t.text), alive: r3(s.ghostMeta.aliveFraction), clusters: s.clusters.length,
      }
    }
    let last = snap()
    log({ type: 'state.initial', state: last })
    setInterval(() => {
      const now = snap(); const changes = {}
      for (const k of Object.keys(now)) { if (JSON.stringify(now[k]) !== JSON.stringify(last[k])) changes[k] = { from: last[k], to: now[k] } }
      if (Object.keys(changes).length) log({ type: 'state', changes })
      last = now
    }, 100)
    setInterval(() => {
      const p = window.__perf, g = window.__ghosts
      log({ type: 'perf', fps: r3(p.fps), workMs: r3(p.workMs), dissolving: p.dissolving, trails: p.trails, peakPerCell: p.peakPerCell, ghostFrames: g ? g.frame : null,
        heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null, dom: document.getElementsByTagName('*').length,
        cards: document.querySelectorAll('li[data-evidence-id]').length, ticks: document.querySelectorAll('[role=slider] span.bg-warm').length })
    }, 1000)
    let cam = ''
    setInterval(() => {
      const m = window.__map; if (!m) return
      const c = m.getCenter(); const k = [m.getZoom().toFixed(2), c.lng.toFixed(4), c.lat.toFixed(4), Math.round(m.getPitch()), Math.round(m.getBearing())].join('|')
      if (k !== cam) { cam = k; log({ type: 'camera', zoom: +m.getZoom().toFixed(2), lon: +c.lng.toFixed(4), lat: +c.lat.toFixed(4), pitch: Math.round(m.getPitch()), bearing: Math.round(m.getBearing()) }) }
    }, 500)
    let feed = ''
    setInterval(() => {
      const sec = document.querySelector('section[aria-label="Drone feed"]')
      if (!sec) { if (feed) { feed = ''; log({ type: 'feed', header: null }) } return }
      const v = sec.querySelector('video'); const h = (sec.querySelector('[data-testid=feed-header]') || {}).textContent
      const k = h + '|' + (v ? v.paused : '') + '|' + (sec.textContent.includes('Flagged'))
      if (k !== feed) { feed = k; log({ type: 'feed', header: h, videoT: v ? Math.round(v.currentTime * 100) / 100 : null, paused: v ? v.paused : null, flagged: sec.textContent.includes('Flagged') }) }
    }, 250)
  }
  start()
})()`

// ---------------------------------------------------------------- servers
async function waitHttp(url, ms = 30000) {
  const end = Date.now() + ms
  while (Date.now() < end) { try { const r = await fetch(url); if (r.ok) return true } catch {} await sleep(250) }
  throw new Error('timed out waiting for ' + url)
}

function startApi(mode, logPath) {
  const out = createWriteStream(logPath)
  const k = spawn(UVICORN, ['backend.api.main:app', '--port', String(API_PORT)], {
    cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OVERWATCH_FAKE_BEATS: mode === 'scripted' ? '0' : '1' },
  })
  k.stdout.pipe(out); k.stderr.pipe(out)
  kids.push(k)
  return k
}
const stopApi = async (k) => { try { process.kill(-k.pid) } catch { k.kill() } await sleep(600); kids.splice(kids.indexOf(k), 1) }

// ---------------------------------------------------------------- one run
async function runOnce(browser, mode, n, header) {
  const tag = `${mode}-${n}`
  const file = createWriteStream(join(OUT, `run-${tag}.jsonl`))
  const api = startApi(mode, join(OUT, `server-${tag}.log`))
  await waitHttp(`http://localhost:${API_PORT}/health`)
  const t0 = Date.now()
  const write = (e) => file.write(JSON.stringify({ t: (e.at ?? Date.now()) - t0, ...e, at: undefined }) + '\n')
  write({ type: 'run.start', mode, n, ...header, apiMode: mode === 'scripted' ? 'OVERWATCH_FAKE_BEATS=0' : 'default' })

  const page = await browser.newPage()
  await page.exposeFunction('__owLog', (e) => write({ ...e, src: 'page' }))
  await page.evaluateOnNewDocument(INSTRUMENT)
  page.on('console', (m) => write({ type: 'console', level: m.type(), text: m.text().slice(0, 400), src: 'browser' }))
  page.on('pageerror', (e) => write({ type: 'pageerror', message: String(e.message ?? e).slice(0, 400), src: 'browser' }))
  page.on('requestfailed', (r) => write({ type: 'requestfailed', url: r.url(), error: r.failure()?.errorText, src: 'browser' }))
  page.on('response', (r) => { if (r.status() >= 400) write({ type: 'response.bad', url: r.url(), status: r.status(), src: 'browser' }) })

  const act = (name, detail, ok = true) => write({ type: 'driver.action', name, detail, ok, src: 'driver' })
  const waitFor = async (what, fn, ms, arg) => {
    const s = Date.now()
    try { const v = await page.waitForFunction(fn, { timeout: ms, polling: 100 }, arg); write({ type: 'driver.wait', what, ms: Date.now() - s, src: 'driver' }); return v }
    catch { write({ type: 'driver.timeout', what, afterMs: Date.now() - s, src: 'driver' }); return null }
  }
  let emit = null

  try {
    await page.goto(`http://localhost:${WEB_PORT}/?autostart=demo`)
    if (!(await waitFor('case opened', () => window.__store?.getState().caseProfile?.case_id, 25000))) throw new Error('case never opened')
    const caseId = await page.evaluate(() => window.__store.getState().caseProfile.case_id)
    write({ type: 'driver.case-open', caseId, src: 'driver' })

    // the officer waits for a drone recommendation, reads it for a moment, and approves it
    const drone = await waitFor('a drone request', () => window.__store.getState().requests.order.some((id) => /^drone/i.test(window.__store.getState().requests.byId[id].asset)), 120000)
    if (drone) {
      await sleep(1500)
      const clicked = await page.evaluate(() => {
        const s = window.__store.getState()
        const id = s.requests.order.find((i) => /^drone/i.test(s.requests.byId[i].asset) && (s.requests.byId[i].status ?? 'pending') === 'pending')
        if (!id) return null
        const card = [...document.querySelectorAll('li, article, section')].find((e) => e.textContent.includes(s.requests.byId[id].asset) && [...e.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Approve'))
        const b = card && [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Approve')
        if (b) b.click()
        return b ? { asset: s.requests.byId[id].asset, gain: s.requests.byId[id].expected_gain } : null
      })
      act('approve-drone', clicked ? JSON.stringify(clicked) : 'no Approve button found', !!clicked)
      await waitFor('the drone feed opens', () => !!document.querySelector('section[aria-label="Drone feed"]'), 10000)
      await sleep(2500)
      if (mode === 'scripted') {
        // the clip's clue, delivered by perception's emit, the way the scripted demo does it
        emit = spawn(PY, ['-m', 'backend.perception.emit', '--case', caseId, '--clip', 'margaret_drone2', '--api', `http://localhost:${API_PORT}`], { cwd: ROOT })
        let o = ''
        emit.stdout.on('data', (d) => (o += d)); emit.stderr.on('data', (d) => (o += d))
        emit.on('close', (code) => write({ type: 'driver.emit', code, output: o.trim().slice(0, 400), src: 'driver' }))
        act('start-emit', 'python -m backend.perception.emit')
      }
    }

    // the possible-match banner is the moment of the demo
    await waitFor('the possible-match banner', () => !!window.__store.getState().found, 90000)
    await waitFor('the drone feed holds on the clue', () => /HELD/.test((document.querySelector('[data-testid=feed-header]') || {}).textContent || ''), 12000)
    await sleep(1500)
    await page.screenshot({ path: join(OUT, `shot-${tag}-found.png`) })

    // read every card (each click shows what that card removed, kept and brought in)
    const ids = await page.evaluate(() => window.__store.getState().evidence.order.slice())
    for (const id of ids) {
      const info = await page.evaluate((id) => {
        const e = window.__store.getState().evidence.byId[id]
        document.querySelector(`li[data-evidence-id="${id}"] button`)?.click()
        return { kind: e.kind, summary: e.summary }
      }, id)
      await sleep(1000)
      const legend = await page.evaluate(() => (document.querySelector('[data-testid=attribution-legend]') || {}).textContent?.replace(/\s+/g, ' ').trim() ?? null)
      write({ type: 'driver.attribution', id, kind: info.kind, legend, src: 'driver' })
      await page.evaluate((id) => document.querySelector(`li[data-evidence-id="${id}"] button`)?.click(), id) // deselect
      await sleep(300)
    }
    act('read-cards', `${ids.length} cards`)

    // the officer asks the biggest cluster "why?": the story types out, arcs go to the evidence behind it, Escape leaves
    const why = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('button.ow-cluster')]
      const pct = (b) => Number((b.getAttribute('aria-label') || '').match(/(\d+) percent/)?.[1] ?? 0)
      bs.sort((a, b) => pct(b) - pct(a))
      if (!bs[0]) return null
      bs[0].click()
      return { pct: pct(bs[0]), rings: bs.length }
    })
    if (why) {
      await sleep(900)
      const early = await page.evaluate(() => (document.querySelector('[data-testid=why-story]') || {}).textContent?.length ?? null)
      await sleep(3800)
      const card = await page.evaluate(() => {
        const c = document.querySelector('[data-testid=why-card]')
        return c && { typed: c.querySelector('[data-testid=why-story]')?.textContent?.length, full: c.querySelector('[data-testid=why-story-full]')?.textContent?.length,
          evidence: c.querySelector('[data-testid=why-count]')?.textContent, pending: !!c.querySelector('[data-testid=why-story-pending]'), noEvidence: !!c.querySelector('[data-testid=why-no-evidence]'),
          litCards: document.querySelectorAll('li[data-why="lit"]').length, litPins: document.querySelectorAll('.ow-pin[data-why="lit"]').length, story: c.querySelector('[data-testid=why-story-full]')?.textContent }
      })
      write({ type: 'driver.why', ...why, typedAfter0_9s: early, ...card, src: 'driver' })
      await page.screenshot({ path: join(OUT, `shot-${tag}-why.png`) })
      await page.keyboard.press('Escape')
      await sleep(600)
      const left = await page.evaluate(() => !document.querySelector('[data-testid=why-card]'))
      act('why-mode', `cluster ${why.pct}%: ${card ? `${card.evidence} evidence, ${card.litCards} cards lit, story ${card.typed}/${card.full} chars` : 'no card'}; Escape left: ${left}`, !!card && left)
    } else act('why-mode', 'no cluster ring to click', false)

    // the officer says it is the subject; the report opens
    const confirmed = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Confirm subject located'); if (b) b.click(); return !!b })
    act('confirm-found', confirmed ? 'Confirm subject located' : 'banner button not found', confirmed)
    if (confirmed) {
      const ok = await waitFor('the report opens', () => !!document.querySelector('section[aria-label="Search report"]'), 15000)
      if (ok) {
        await sleep(2500)
        const rep = await page.evaluate(() => {
          const sec = document.querySelector('section[aria-label="Search report"]')
          const heads = [...sec.querySelectorAll('h2,h3')].map((h) => h.textContent.trim().replace(/\s+/g, ' '))
          return { headings: heads, outcome: (sec.textContent.match(/Located|Search closed|Search ongoing/) || [null])[0], hasDroneDetections: /Drone detections/.test(sec.textContent), images: sec.querySelectorAll('img').length, text: sec.textContent.replace(/\s+/g, ' ').slice(0, 220) }
        })
        write({ type: 'driver.report', ...rep, src: 'driver' })
        const pdf = await page.evaluate(async (id, api) => {
          try { const r = await fetch(`${api}/report/${id}/pdf`); const b = await r.arrayBuffer(); return { status: r.status, type: r.headers.get('content-type'), bytes: b.byteLength } } catch (e) { return { error: String(e) } }
        }, caseId, `http://localhost:${API_PORT}`)
        write({ type: 'driver.pdf', ...pdf, src: 'driver' })
        await page.screenshot({ path: join(OUT, `shot-${tag}-report.png`) })
      }
    }
    await sleep(2000)
    const final = await page.evaluate(() => {
      const s = window.__store.getState()
      return { evidence: s.evidence.order.length, requests: s.requests.order.length, log: s.log.length, alive: s.ghostMeta.aliveFraction, connection: s.connection?.state, found: !!s.found,
        logTail: s.log.slice(-5).map((l) => `${l.actor}: ${l.action}: ${(l.detail || '').slice(0, 90)}`) }
    })
    write({ type: 'driver.final', ...final, src: 'driver' })
  } catch (e) {
    write({ type: 'driver.crash', error: String(e.message ?? e), src: 'driver' })
  } finally {
    try { await page.screenshot({ path: join(OUT, `shot-${tag}-end.png`) }) } catch {}
    if (emit) { try { emit.kill() } catch {} }
    await page.close().catch(() => {})
    await stopApi(api)
    write({ type: 'run.end', src: 'driver' })
    await new Promise((r) => file.end(r))
  }
  console.log(`  run ${tag} finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}

// ---------------------------------------------------------------- main
console.log(`Logging ${RUNS} run(s) of each mode (${MODES.join(', ')}) to ${OUT}`)
const web = spawn('npx', ['vite', '--port', String(WEB_PORT), '--strictPort'], { cwd: FRONT, detached: true, stdio: 'ignore', env: { ...process.env, VITE_API_URL: `http://localhost:${API_PORT}` } })
kids.push(web)
await waitHttp(`http://localhost:${WEB_PORT}/`)
const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'], defaultViewport: { width: 1440, height: 900 } })
const header = { commit: sh('git rev-parse --short HEAD'), branch: sh('git branch --show-current'), chrome: await browser.version(), node: process.version, viewport: '1440x900' }
writeFileSync(join(OUT, 'environment.json'), JSON.stringify({ ...header, runs: RUNS, modes: MODES, started: new Date().toISOString() }, null, 1))
try {
  for (let n = 1; n <= RUNS; n++) for (const mode of MODES) await runOnce(browser, mode, n, header)
} finally {
  await browser.close().catch(() => {})
  killAll()
}
const { out } = buildReport(OUT)
console.log('Report:', out)
process.exit(0)
