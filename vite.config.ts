import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
  },
  // Keep a single React instance across app + deps (hygiene). Note: the
  // "Invalid hook call" console noise on `npm run dev` originates from the
  // TanStack devtools' own pre-bundled react-dom and is dev-only — the
  // devtools are gated behind `import.meta.env.DEV` in __root.tsx, so a
  // production build ships neither the devtools nor those errors.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  plugins: [
    tsConfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
