import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The dev server runs in WSL while the source lives on the Windows
    // filesystem (/mnt/c). Native inotify events don't cross that boundary,
    // so HMR misses edits — poll for changes instead.
    watch: { usePolling: true, interval: 300 },
  },
})
