import * as React from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Sonner toaster wired to our class-based theme (we don't use next-themes):
 * watches the `dark` class on <html> and follows it.
 */
export function Toaster(props: ToasterProps) {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('light')

  React.useEffect(() => {
    const el = document.documentElement
    const update = () =>
      setTheme(el.classList.contains('dark') ? 'dark' : 'light')
    update()
    const observer = new MutationObserver(update)
    observer.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  )
}
