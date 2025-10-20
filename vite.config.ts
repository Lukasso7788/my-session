import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    outDir: 'dist',          // куда складывать продакшн билд
    sourcemap: false,        // отключаем карты (меньше вес)
  },
  server: {
    port: 5173,              // локальный порт
  },
  preview: {
    port: 4173,              // порт для npm run preview
  },
  resolve: {
    alias: {
      '@': '/src',           // чтобы можно было писать "@/components/..."
    },
  },
})
