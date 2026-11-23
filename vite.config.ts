import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const BUILD = String(Date.now())
// Ghi version.json để app tự tải lại khi có bản mới (Safari/iPhone hay giữ bản cũ)
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) }) },
})

// base './' để chạy được trên GitHub Pages (thư mục con)
export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [react(), versionFile()],
  build: { chunkSizeWarningLimit: 2000 },
})
