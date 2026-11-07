// Dev-HUD numbers for the render loop. Plain object, updated outside React, read by a timer.
export const perf = {
  /** Animation frames per second over the last ~0.5 s. */
  fps: 0,
  /** Time the render loop spent blending and handing data to deck.gl last frame, ms. */
  workMs: 0,
}
