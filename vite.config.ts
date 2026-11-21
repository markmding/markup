import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// Tauri sets this when developing against a physical device / LAN.
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  // Prevents Vite from clearing Rust compiler output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri uses WebView2 (Chromium) on Windows and WKWebView on macOS.
    target: 'es2021',
    minify: 'esbuild',
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    // Mermaid is intentionally a large lazy chunk; see renderMermaid().
    chunkSizeWarningLimit: 3000
  }
})
