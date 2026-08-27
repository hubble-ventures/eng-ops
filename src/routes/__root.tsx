import type { QueryClient } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import appCss from '~/styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      // Light-only by design: keep UA controls/scrollbars light rather than
      // rendering OS-dark chrome against the light UI.
      { name: 'color-scheme', content: 'light' },
      { title: 'pg-admin' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
})

function Breadcrumbs() {
  const matches = useRouterState({ select: (s) => s.matches })
  const crumbs = matches
    .map((m) => {
      const ctx = m.context as { crumb?: string } | undefined
      return ctx?.crumb
    })
    .filter((c): c is string => Boolean(c))

  if (crumbs.length === 0) return null

  return (
    <nav className="crumb" aria-label="breadcrumb">
      {crumbs.join(' / ')}
    </nav>
  )
}

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <div className="app-shell">
          <header className="app-header">
            <Link to="/" className="brand">
              pg-admin
            </Link>
            <Breadcrumbs />
          </header>
          <main className="app-main">
            <Outlet />
          </main>
        </div>
        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <Scripts />
      </body>
    </html>
  )
}
