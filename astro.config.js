import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [svelte()],
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  server: { port: 3456 },
  vite: {
    plugins: [tailwindcss()],
  },
});
