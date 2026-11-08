// Drawing the detection boxes over the drone video (step 34). Plain 2D canvas, outside React, redrawn only when the
// moment changes. Person boxes are subtle (warm-white, thin). A clothing match is cyan with its label: cyan means
// "the AI says so" in this design. A held (flagged) detection gets a heavy box, corner marks and a larger label,
// and the other boxes step back.
import { boxLabel, boxToRect, type FootageDetection, type Rect } from '@/lib/footage'
import { tokens } from '@/lib/tokens'

export interface PaintArgs {
  ctx: CanvasRenderingContext2D
  /** Canvas size in CSS pixels (the context is already scaled for the device pixel ratio). */
  width: number
  height: number
  /** Where the picture sits inside the canvas. */
  picture: Rect
  detections: readonly FootageDetection[]
  /** The detection the stream says to look at, if the feed is held. */
  held: FootageDetection | null
}

const sameBox = (a: FootageDetection, b: FootageDetection): boolean =>
  a.frame === b.frame && a.box.every((v, i) => v === b.box[i])

const FONT = "11px 'IBM Plex Mono', ui-monospace, monospace"

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxRight: number): void {
  ctx.font = size === 11 ? FONT : `${size}px 'IBM Plex Mono', ui-monospace, monospace`
  const w = ctx.measureText(text).width + 8
  const h = size + 6
  const left = Math.max(2, Math.min(x, maxRight - w - 2))
  const top = y - h - 2 < 2 ? y + 4 : y - h - 2
  ctx.fillStyle = 'rgba(6, 8, 11, 0.82)'
  ctx.fillRect(left, top, w, h)
  ctx.fillStyle = tokens.cyan
  ctx.textBaseline = 'middle'
  ctx.fillText(text, left + 4, top + h / 2 + 0.5)
}

export function paintBoxes({ ctx, width, height, picture, detections, held }: PaintArgs): void {
  ctx.clearRect(0, 0, width, height)
  const right = picture.x + picture.w
  const dim = held !== null
  // Plain people first, then matches, then the held one on top.
  const order = [...detections].sort((a, b) => Number(a.matched) - Number(b.matched))
  for (const d of order) {
    const isHeld = held !== null && sameBox(d, held)
    if (isHeld) continue
    const r = boxToRect(picture, d.box)
    const w = Math.max(r.w, 5), h = Math.max(r.h, 5)
    const x = r.x - (w - r.w) / 2, y = r.y - (h - r.h) / 2
    if (d.matched) {
      ctx.globalAlpha = dim ? 0.55 : 1
      ctx.strokeStyle = tokens.cyan
      ctx.lineWidth = 1.5
      ctx.strokeRect(x, y, w, h)
      const text = boxLabel(d)
      if (text) label(ctx, text, x, y, 11, right)
    } else {
      ctx.globalAlpha = dim ? 0.3 : 0.6
      ctx.strokeStyle = tokens.warmWhite
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, w, h)
    }
    ctx.globalAlpha = 1
  }
  if (held) {
    const r = boxToRect(picture, held.box)
    const pad = 3
    const x = r.x - pad, y = r.y - pad, w = r.w + pad * 2, h = r.h + pad * 2
    ctx.strokeStyle = tokens.cyan
    ctx.lineWidth = 2.5
    ctx.strokeRect(x, y, w, h)
    // Corner marks, so the box reads as "looked at" and not just "detected".
    const c = Math.min(10, w / 3, h / 3)
    ctx.lineWidth = 4
    ctx.beginPath()
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) {
      ctx.moveTo(cx, cy + dy * c); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * c, cy)
    }
    ctx.stroke()
    const text = boxLabel(held)
    if (text) label(ctx, text, x, y, 13, right)
  }
}
