import * as React from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '~/components/ui/button'

/**
 * Reads/writes the `theme` in localStorage and toggles the `dark` class on
 * <html>. The initial class is set by an inline script in the document head
 * (see __root.tsx) to avoid a flash of the wrong theme on first paint.
 */
export function ThemeToggle() {
  const [isDark, setIsDark] = React.useState(false)

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // ignore storage failures (private mode, etc.)
    }
    setIsDark(next)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}

/** Inline script (stringified) that applies the saved theme before paint. */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark')}}catch(e){}})()`
