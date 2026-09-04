import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // The port is claimed by scripts/portlock.mjs and passed in as WEB_PORT, so
    // parallel worktrees never fight over one number. `strictPort` makes a
    // collision a loud failure instead of a silent drift to the next free port
    // — a drifting port is exactly what the claim exists to prevent.
    port: Number(process.env.WEB_PORT ?? 3000),
    strictPort: true,
    // portless serves the app as https://<name>.localhost (and, in a linked
    // worktree, https://<branch>.<name>.localhost). Vite rejects Host headers
    // it does not know, so the whole TLD is allowed rather than one generated
    // name.
    allowedHosts: ['.localhost'],
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
