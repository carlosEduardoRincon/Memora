import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativo: funciona em qualquer subcaminho (ex.: GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node' },
} as any);
