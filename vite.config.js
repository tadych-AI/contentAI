import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base = nazwa repozytorium – strona działa pod https://tadych-ai.github.io/contentAI/
export default defineConfig({
  plugins: [react()],
  base: '/contentAI/',
})
