import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Storybook renders client components only; the Worker plugin stays out.
export default defineConfig({
  plugins: [...react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)) } },
});
