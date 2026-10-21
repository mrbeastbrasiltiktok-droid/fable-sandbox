import { defineConfig } from 'vite';
export default defineConfig({ server: { port: 5176, open: false }, build: { target: 'esnext' } });
