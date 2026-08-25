import { QueryCache, QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { toast } from 'sonner'

import { routeTree } from './routeTree.gen'

export function getRouter() {
  const queryClient = new QueryClient({
    // Surface query failures as toasts on the client. Redirects are
    // intercepted by the SSR-query integration before reaching here, and
    // the router's errorComponent still renders loader errors in-page.
    queryCache: new QueryCache({
      onError: (error) => {
        if (typeof window === 'undefined') return
        toast.error('Query failed', {
          description: error instanceof Error ? error.message : String(error),
        })
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ({ error }: { error: unknown }) => (
      <div className="border-destructive/40 bg-destructive/10 text-destructive m-4 rounded-lg border p-4 text-sm">
        {error instanceof Error ? error.message : String(error)}
      </div>
    ),
    defaultNotFoundComponent: () => (
      <div className="text-muted-foreground m-4 rounded-lg border p-4 text-sm">
        Page not found.
      </div>
    ),
    scrollRestoration: true,
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
    handleRedirects: true,
    wrapQueryClient: true,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
