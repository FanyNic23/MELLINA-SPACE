import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// En desarrollo (npm run dev) las llamadas a la API van al Edge Core local.
// En producción la app compilada (dist/) la sirve el propio Edge Core: mismo origen, sin internet.
const EDGE_CORE = 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/health', '/link', '/sync', '/simulator', '/telemetry', '/voice'].map(p => [p, EDGE_CORE]),
    ),
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1200 },
})
