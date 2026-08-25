import * as React from 'react'
import { Refine } from '@refinedev/core'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
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
import { ChevronRight, Menu, Search, X } from 'lucide-react'

import { AppSidebar } from '~/components/AppSidebar'
import { CommandMenu } from '~/components/CommandMenu'
import { themeInitScript } from '~/components/ThemeToggle'
import { Button } from '~/components/ui/button'
import { Toaster } from '~/components/ui/sonner'
import { TooltipProvider } from '~/components/ui/tooltip'
import { dataProvider } from '~/lib/refine/dataProvider'
import { notificationProvider } from '~/lib/refine/notificationProvider'
import { entitiesListQuery } from '~/lib/queries'
import appCss from '~/styles.css?url'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'eng-ops' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(entitiesListQuery()),
  component: RootComponent,
})

function Breadcrumbs() {
  const matches = useRouterState({ select: (s) => s.matches })
  const crumbs = matches
    .map((m) => (m.context as { crumb?: string } | undefined)?.crumb)
    .filter((c): c is string => Boolean(c))

  if (crumbs.length === 0) return null

  return (
    <nav
      className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm"
      aria-label="breadcrumb"
    >
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <ChevronRight className="size-3.5 shrink-0 opacity-50" />}
          <span
            className={
              i === crumbs.length - 1
                ? 'text-foreground truncate font-medium'
                : 'truncate'
            }
          >
            {c}
          </span>
        </React.Fragment>
      ))}
    </nav>
  )
}

function RootComponent() {
  const queryClient = useQueryClient()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [cmdOpen, setCmdOpen] = React.useState(false)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCmdOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <Refine
          dataProvider={dataProvider}
          notificationProvider={notificationProvider}
          options={{
            reactQuery: { clientConfig: queryClient },
            disableTelemetry: true,
            warnWhenUnsavedChanges: false,
          }}
        >
        <TooltipProvider>
          <div className="grid min-h-screen md:grid-cols-[16rem_1fr]">
            <aside className="bg-card/30 sticky top-0 hidden h-screen border-r md:block">
              <AppSidebar />
            </aside>

            <div className="flex min-w-0 flex-col">
              <header className="bg-background/80 sticky top-0 z-20 flex h-12 items-center gap-2 border-b px-4 backdrop-blur">
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Open menu"
                >
                  <Menu />
                </Button>
                <Link to="/" className="font-semibold md:hidden">
                  eng-ops
                </Link>
                <div className="hidden md:block">
                  <Breadcrumbs />
                </div>
                <button
                  type="button"
                  onClick={() => setCmdOpen(true)}
                  className="text-muted-foreground hover:bg-accent ml-auto flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <Search className="size-4" />
                  <span className="hidden sm:inline">Search tables…</span>
                  <kbd className="bg-muted hidden rounded px-1.5 py-0.5 font-mono text-[10px] sm:inline">
                    ⌘K
                  </kbd>
                </button>
              </header>
              <main className="min-w-0 flex-1 p-4 md:p-6">
                <Outlet />
              </main>
            </div>
          </div>

          {mobileOpen && (
            <div className="fixed inset-0 z-50 md:hidden">
              <div
                className="bg-background/60 absolute inset-0 backdrop-blur-sm"
                onClick={() => setMobileOpen(false)}
              />
              <div className="bg-card absolute inset-y-0 left-0 w-72 border-r shadow-xl">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => setMobileOpen(false)}
                  aria-label="Close menu"
                >
                  <X />
                </Button>
                <AppSidebar onNavigate={() => setMobileOpen(false)} />
              </div>
            </div>
          )}

          <CommandMenu open={cmdOpen} onOpenChange={setCmdOpen} />
          <Toaster />
        </TooltipProvider>
        </Refine>

        <TanStackRouterDevtools position="bottom-right" />
        <ReactQueryDevtools buttonPosition="bottom-left" />
        <Scripts />
      </body>
    </html>
  )
}
