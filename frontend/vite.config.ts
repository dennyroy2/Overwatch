import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

/**
 * Plain `.ts` modules in src/ hold live state: the store, the ghost buffers, the stream socket, the recorder, the
 * card-attribution overlay and the requestAnimationFrame loop that draws the map. Hot-swapping one makes a second copy
 * of that state while the running loop keeps the first, so the screen silently splits in two (clicking a card set
 * the legend on the new copy while the map kept drawing from the old one: no red/cyan ghosts until a reload). When one
 * of them changes, reload the page instead. Components (.tsx) and CSS keep hot-updating as before.
 */
function reloadOnStateModuleChange(): Plugin {
  const src = path.resolve(import.meta.dirname, 'src') + path.sep
  return {
    name: 'overwatch:reload-on-state-module-change',
    hotUpdate({ file }) {
      if (this.environment.name !== 'client') return
      if (!file.startsWith(src) || !file.endsWith('.ts') || /\.(test|d)\.ts$/.test(file)) return
      this.environment.hot.send({ type: 'full-reload' })
      return []
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [reloadOnStateModuleChange(), react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173 },
})
