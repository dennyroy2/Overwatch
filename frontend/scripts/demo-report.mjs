// Reads the run logs written by demo-log.mjs and writes REPORT.md: what happened in each run, and how the runs differ.
//   node scripts/demo-report.mjs demo-logs/<stamp>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
const r1 = (x) => (x === null || x === undefined ? '-' : typeof x === 'number' ? (Math.round(x * 10) / 10).toString() : String(x))
const sec = (ms) => (ms === null || ms === undefined ? '-' : (ms / 1000).toFixed(1) + ' s')

export function readRun(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

/** One run's facts, from its log. */
export function analyse(events) {
  const head = events.find((e) => e.type === 'run.start') ?? {}
  const ofType = (t) => events.filter((e) => e.type === t)
  const first = (pred) => events.find(pred)?.t ?? null
  const R = { mode: head.mode, n: head.n, commit: head.commit, chrome: head.chrome }

  // ---- milestones (ms since the run started)
  const ws = events.filter((e) => e.type.startsWith('ws.'))
  const ev = ofType('ws.evidence')
  R.m = {
    caseOpened: first((e) => e.type === 'driver.case-open'),
    wsOpen: first((e) => e.type === 'ws.open'),
    firstGhosts: first((e) => e.type === 'ws.ghosts'),
    firstEvidence: ev[0]?.t ?? null,
    evidenceTimes: ev.map((e) => e.t),
    evidenceKinds: ev.map((e) => e.data?.kind),
    firstTasking: first((e) => e.type === 'ws.tasking'),
    approveClick: first((e) => e.type === 'driver.action' && e.name === 'approve-drone'),
    pipOpened: first((e) => e.type === 'state' && e.changes?.panels && JSON.stringify(e.changes.panels.to).includes('"pip":true')),
    firstFeedHeld: first((e) => e.type === 'feed' && /HELD/.test(e.header ?? '')),
    foundBanner: first((e) => e.type === 'ws.found'),
    confirmClick: first((e) => e.type === 'driver.action' && e.name === 'confirm-found'),
    reportOpened: first((e) => e.type === 'driver.report'),
  }

  // ---- messages
  const count = {}
  for (const e of ws) count[e.type] = (count[e.type] ?? 0) + 1
  R.counts = count
  const frames = ofType('ws.ghosts')
  const gaps = frames.slice(1).map((e, i) => e.t - frames[i].t)
  R.frames = { n: frames.length, gapMedian: med(gaps), gapP95: pct(gaps, 0.95), gapMax: gaps.length ? Math.max(...gaps) : null, over500: gaps.filter((g) => g > 500).length }
  const sims = frames.map((e) => Date.parse(e.simTime))
  R.simTimeBackwards = sims.some((s, i) => i > 0 && s < sims[i - 1])
  R.respawnPeak = Math.max(0, ...frames.map((e) => e.respawned ?? 0))
  R.respawnEvents = frames.filter((e) => (e.respawned ?? 0) > 100).map((e) => ({ t: e.t, n: e.respawned }))
  R.droneClues = ev.filter((e) => e.data?.source === 'drone_ai').map((e) => `${(e.t / 1000).toFixed(1)}s ${e.data?.id?.slice(-14)} "${(e.data?.summary ?? '').slice(0, 50)}"`)
  R.alive = { min: frames.length ? Math.min(...frames.map((e) => e.alive)) : null, final: frames.at(-1)?.alive ?? null }
  R.topCluster = frames.at(-1)?.clusters?.[0] ?? null
  R.storyNull = frames.filter((e) => e.clusters?.some((c) => !c.story)).length
  const ids = ev.map((e) => e.data?.id)
  R.duplicateEvidenceIds = ids.length - new Set(ids).size
  R.evidenceSummaries = ev.map((e) => `${(e.t / 1000).toFixed(1)}s ${e.data?.kind}/${e.data?.source} rel ${e.data?.reliability} "${(e.data?.summary ?? '').slice(0, 60)}"`)
  R.requests = ofType('ws.tasking').map((e) => `${(e.t / 1000).toFixed(1)}s ${e.data?.asset} ${e.data?.status ?? 'pending'} gain ${e.data?.expected_gain}`)

  // ---- http / sockets
  const apiHost = (() => { try { return new URL(ofType('ws.connect')[0].url).host } catch { return null } })()
  const isApi = (u) => { try { return new URL(u).host === apiHost } catch { return false } }
  const http = ofType('http').filter((h) => isApi(h.url))
  const failed = ofType('http.fail')
  R.http = { n: http.length, bad: http.filter((h) => h.status >= 400).map((h) => `${h.method} ${h.url} ${h.status}`),
    failed: failed.filter((h) => isApi(h.url)).length, failedList: failed.filter((h) => isApi(h.url)).map((h) => `${h.method} ${h.url} ${h.error}`),
    cancelledOther: failed.filter((h) => !isApi(h.url)).length,
    posts: http.filter((h) => h.method === 'POST').map((h) => `${h.method} ${h.url.replace(/^https?:\/\/[^/]+/, '')} ${h.status}`),
    slowest: http.length ? Math.max(...http.map((h) => h.ms)) : null }
  R.sockets = { opens: ofType('ws.open').length, closes: ofType('ws.close').map((e) => e.code), errors: ofType('ws.error').length }

  // ---- console and errors
  const cons = ofType('console')
  R.console = { error: cons.filter((c) => c.level === 'error').length, warning: cons.filter((c) => c.level === 'warning').length, other: cons.filter((c) => !['error', 'warning'].includes(c.level)).length, errors: cons.filter((c) => c.level === 'error').map((c) => c.text.slice(0, 140)), warnings: [...new Set(cons.filter((c) => c.level === 'warning').map((c) => c.text.slice(0, 140)))] }
  R.pageErrors = ofType('pageerror').map((e) => e.message.slice(0, 160))
  const rf = ofType('requestfailed')
  R.requestFailed = rf.filter((e) => !/ERR_ABORTED/.test(e.error ?? '')).map((e) => `${e.url.replace(/^https?:\/\/[^/]+/, '')} ${e.error}`)
  R.requestsCancelled = rf.length - R.requestFailed.length // map tiles the map library cancelled while the camera moved: normal
  R.badResponses = ofType('response.bad').map((e) => `${e.status} ${e.url.replace(/^https?:\/\/[^/]+/, '')}`)

  // ---- performance
  const perf = ofType('perf')
  const fps = perf.map((p) => p.fps).filter((f) => f > 0)
  R.perf = { samples: perf.length, fpsMin: fps.length ? Math.min(...fps) : null, fpsP5: pct(fps, 0.05), fpsMedian: med(fps), workMax: Math.max(0, ...perf.map((p) => p.workMs || 0)),
    heapEarly: med(perf.slice(Math.floor(perf.length * 0.2), Math.floor(perf.length * 0.4)).map((p) => p.heapMB || 0)), heapLate: med(perf.slice(Math.floor(perf.length * 0.7)).map((p) => p.heapMB || 0)),
    heapStart: perf[1]?.heapMB ?? perf[0]?.heapMB ?? null, heapMax: Math.max(0, ...perf.map((p) => p.heapMB || 0)), heapEnd: perf.at(-1)?.heapMB ?? null, domMax: Math.max(0, ...perf.map((p) => p.dom || 0)),
    dissolvingPeak: Math.max(0, ...perf.map((p) => p.dissolving || 0)), longframes: ofType('longframe').length, longframeMax: Math.max(0, ...ofType('longframe').map((e) => e.ms)),
    longtasks: ofType('longtask').length, longtaskMax: Math.max(0, ...ofType('longtask').map((e) => e.ms)) }
  R.lowFpsSeconds = perf.filter((p) => p.fps > 0 && p.fps < 50).map((p) => `${(p.t / 1000).toFixed(0)}s:${Math.round(p.fps)}`)

  // ---- the screen
  const states = ofType('state')
  R.toasts = [...new Set(states.flatMap((s) => (s.changes?.toasts ? s.changes.toasts.to : [])))]
  R.connectionStates = [ofType('state.initial')[0]?.state?.connection, ...states.filter((s) => s.changes?.connection).map((s) => s.changes.connection.to)].filter(Boolean)
  R.feed = ofType('feed').map((f) => `${(f.t / 1000).toFixed(1)}s ${f.header} t=${f.videoT}${f.paused ? ' paused' : ''}`)
  R.feedHeldAt = ofType('feed').find((f) => /HELD/.test(f.header ?? ''))?.videoT ?? null
  R.cameraMoves = ofType('camera').length
  R.attribution = ofType('driver.attribution').map((a) => `${a.kind}: ${a.legend}`)
  R.report = ofType('driver.report').at(0) ?? null
  R.pdf = ofType('driver.pdf').at(0) ?? null
  R.actions = ofType('driver.action').map((a) => `${(a.t / 1000).toFixed(1)}s ${a.name} ${a.ok === false ? 'FAILED ' : ''}${a.detail ?? ''}`)
  R.timeouts = ofType('driver.timeout').map((a) => `${a.what} after ${sec(a.afterMs)}`)
  R.final = ofType('driver.final').at(0) ?? null
  R.duration = events.at(-1)?.t ?? null
  // the order things happened in, to compare runs by shape and not by exact time
  R.signature = events.filter((e) => ['ws.evidence', 'ws.tasking', 'ws.found', 'driver.action', 'driver.report'].includes(e.type)).map((e) => (e.type === 'driver.action' ? 'do:' + e.name : e.type === 'ws.evidence' ? 'ev:' + e.data?.kind : e.type.replace('ws.', ''))).join(' > ')
  return R
}

const row = (cells) => '| ' + cells.join(' | ') + ' |'
const stat = (vals, f = r1) => {
  const v = vals.filter((x) => x !== null && x !== undefined && !Number.isNaN(x))
  if (!v.length) return '-'
  const lo = Math.min(...v), hi = Math.max(...v)
  return lo === hi ? f(lo) : `${f(lo)} to ${f(hi)} (median ${f(med(v))})`
}

export function buildReport(dir) {
  const files = readdirSync(dir).filter((f) => /^run-.*\.jsonl$/.test(f)).sort()
  const runs = files.map((f) => ({ file: f, ...analyse(readRun(join(dir, f))) }))
  const L = []
  L.push(`# Demo log report`, '', `Logs: \`${dir}\` (${runs.length} runs). Raw, timestamped events are in each \`run-*.jsonl\`; the server's own output is in \`server-*.log\`.`, '')
  for (const mode of [...new Set(runs.map((r) => r.mode))]) {
    const rs = runs.filter((r) => r.mode === mode)
    L.push(`## Mode \`${mode}\` (${rs.length} runs)`, '')
    L.push(row(['', ...rs.map((r) => `run ${r.n}`), 'spread']), row(['---', ...rs.map(() => '---'), '---']))
    const line = (label, f, fmt = r1, all = true) => L.push(row([label, ...rs.map((r) => fmt(f(r))), all ? stat(rs.map(f), fmt) : '']))
    line('run length', (r) => r.duration, sec)
    line('socket open', (r) => r.m.wsOpen, sec)
    line('first ghost frame', (r) => r.m.firstGhosts, sec)
    line('first evidence', (r) => r.m.firstEvidence, sec)
    line('first tasking request', (r) => r.m.firstTasking, sec)
    line('officer approves drone', (r) => r.m.approveClick, sec)
    line('drone feed opened', (r) => r.m.pipOpened, sec)
    line('drone feed held on the clue', (r) => r.m.firstFeedHeld, sec)
    line('possible-match banner', (r) => r.m.foundBanner, sec)
    line('report opened', (r) => r.m.reportOpened, sec)
    line('evidence cards', (r) => r.counts['ws.evidence'] ?? 0)
    line('tasking messages', (r) => r.counts['ws.tasking'] ?? 0)
    line('log messages', (r) => r.counts['ws.log'] ?? 0)
    line('ghost frames', (r) => r.frames.n)
    line('frame gap median (ms)', (r) => r.frames.gapMedian)
    line('frame gap max (ms)', (r) => r.frames.gapMax)
    line('largest respawn in one frame', (r) => r.respawnPeak)
    line('ghosts alive (final)', (r) => r.alive.final, (x) => (x === null ? '-' : x.toFixed(3)))
    line('fps lowest', (r) => r.perf.fpsMin)
    line('fps 5th percentile', (r) => r.perf.fpsP5)
    line('slowest frame of work (ms)', (r) => r.perf.workMax)
    line('long frames (>50 ms)', (r) => r.perf.longframes)
    line('long tasks (>80 ms)', (r) => r.perf.longtasks)
    line('JS heap, early vs late median (MB)', (r) => r.perf.heapLate - r.perf.heapEarly)
    line('JS heap peak (MB)', (r) => r.perf.heapMax)
    line('drone clues delivered', (r) => r.droneClues.length)
    line('PDF export', (r) => (r.pdf ? (r.pdf.error ? 'FAILED' : r.pdf.status) : '-'), String, false)
    line('console errors', (r) => r.console.error)
    line('console warnings', (r) => r.console.warning)
    line('page errors', (r) => r.pageErrors.length)
    line('API errors (4xx, 5xx, failed)', (r) => r.http.bad.length + r.http.failed)
    line('slowest API call (ms)', (r) => r.http.slowest)
    line('map tile requests cancelled (normal)', (r) => r.requestsCancelled + r.http.cancelledOther)
    line('sim time went backwards', (r) => (r.simTimeBackwards ? 'YES' : 'no'), String, false)
    line('duplicate evidence ids', (r) => r.duplicateEvidenceIds)
    L.push('')
    const sigs = [...new Set(rs.map((r) => r.signature))]
    L.push(sigs.length === 1 ? `**The order of events was identical in all ${rs.length} runs:**` : `**The order of events DIFFERED between runs (${sigs.length} different orders):**`, '')
    sigs.forEach((s) => L.push('- ' + s + (sigs.length > 1 ? `  (runs ${rs.filter((r) => r.signature === s).map((r) => r.n).join(', ')})` : '')))
    L.push('')
    for (const r of rs) {
      L.push(`### ${mode}, run ${r.n}`, '')
      L.push(`- Actions: ${r.actions.join('; ') || 'none'}`)
      if (r.timeouts.length) L.push(`- **Timeouts:** ${r.timeouts.join('; ')}`)
      L.push(`- Evidence: ${r.evidenceSummaries.join(' | ') || 'none'}`)
      if (r.droneClues.length > 1) L.push(`- **${r.droneClues.length} drone clues were delivered (double counting):** ${r.droneClues.join(' | ')}`)
      L.push(`- Requests: ${r.requests.join(' | ') || 'none'}`)
      L.push(`- POSTs: ${r.http.posts.join(', ') || 'none'}`)
      L.push(`- Big respawns (over 100 slots): ${r.respawnEvents.map((x) => `${(x.t / 1000).toFixed(1)}s:${x.n}`).join(', ') || 'none'}; dissolving peak ${r.perf.dissolvingPeak}`)
      L.push(`- Drone feed: held on video t=${r.feedHeldAt ?? 'never'}; states ${[...new Set(r.feed.map((f) => f.split(' ')[1]))].join(', ') || 'never opened'}`)
      L.push(`- Overlay legends: ${r.attribution.join(' | ') || 'none'}`)
      L.push(`- Toasts: ${r.toasts.join(' | ') || 'none'}; connection: ${[...new Set(r.connectionStates)].join(' > ') || '-'}; sockets: ${r.sockets.opens} opened, closes ${r.sockets.closes.join(',') || 'none'}, errors ${r.sockets.errors}`)
      L.push(`- Clusters without a story in a frame: ${r.storyNull} frames; top cluster at the end: ${r.topCluster ? `${r.topCluster.p} at ${r.topCluster.lat}, ${r.topCluster.lon}` : '-'}`)
      if (r.report) L.push(`- Report on screen: outcome ${r.report.outcome}; sections ${r.report.headings.join(', ')}`)
      if (r.pdf) L.push(`- PDF: ${r.pdf.error ? 'ERROR ' + r.pdf.error : `status ${r.pdf.status}, ${r.pdf.type}, ${r.pdf.bytes} bytes`}`)
      if (r.console.errors.length) L.push(`- Console errors: ${r.console.errors.join(' | ')}`)
      if (r.console.warnings.length) L.push(`- Console warnings: ${r.console.warnings.join(' | ')}`)
      if (r.pageErrors.length) L.push(`- Page errors: ${r.pageErrors.join(' | ')}`)
      if (r.requestFailed.length) L.push(`- Failed requests (not cancelled): ${r.requestFailed.join(' | ')}`)
      if (r.http.failedList.length) L.push(`- Failed API calls: ${r.http.failedList.join(' | ')}`)
      if (r.badResponses.length) L.push(`- Bad responses: ${r.badResponses.join(' | ')}`)
      if (r.lowFpsSeconds.length) L.push(`- Seconds under 50 fps: ${r.lowFpsSeconds.join(', ')}`)
      L.push('')
    }
  }
  const out = join(dir, 'REPORT.md')
  writeFileSync(out, L.join('\n'))
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(runs, null, 1))
  return { out, runs }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2]
  if (!dir) { console.error('usage: node scripts/demo-report.mjs demo-logs/<stamp>'); process.exit(2) }
  console.log('wrote', buildReport(dir).out)
}
