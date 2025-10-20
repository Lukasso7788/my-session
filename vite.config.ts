import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: './', // делает пути к JS/CSS относительными (иначе MIME ошибка)
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    outDir: 'dist',          // куда билдить
    assetsDir: './assets',   // фикс путей к ассетам
    sourcemap: false,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
