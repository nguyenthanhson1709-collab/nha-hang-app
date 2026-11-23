import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' để chạy được trên GitHub Pages (thư mục con)
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 2000 },
})
