import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import websocket from './src/integrations/websocket.js';

export default defineConfig({
  site: 'https://think-done.com',
  integrations: [svelte(), mdx(), sitemap({
    filter: (page) => !page.includes('/app') && !page.includes('/meeting') && !page.includes('/settings') && !page.includes('/tasks') && !page.includes('/usage'),
  }), websocket()],
  output: 'server',
  adapter: cloudflare(),
  devToolbar: { enabled: false },
  server: { port: 3456 },
  vite: {
    plugins: [tailwindcss()],
    define: {
      'import.meta.env.GOOGLE_CLIENT_ID': JSON.stringify('877430513382-bpovb69jsiijd8r88uhck8heubc8qpnh.apps.googleusercontent.com'),
    },
    build: { target: 'esnext' },
    optimizeDeps: {
      exclude: ['@tursodatabase/database-wasm'],
      esbuildOptions: { target: 'esnext' },
    },
    server: {
      headers: {
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
  },
});
