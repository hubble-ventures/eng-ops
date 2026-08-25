import { Link, createFileRoute } from '@tanstack/react-router'

import { entitiesListQuery } from '~/lib/queries'

export const Route = createFileRoute('/')({
  beforeLoad: () => ({ crumb: 'Home' }),
  loader: ({ context }) => context.queryClient.ensureQueryData(entitiesListQuery()),
  component: HomePage,
})

function HomePage() {
  const data = Route.useLoaderData()

  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Entities</h1>
        <span className="pill">{data.entities.length} tables</span>
      </div>
      <div className="entity-grid">
        {data.entities.map((e) => (
          <Link
            key={e.id}
            to="/entities/$table"
            params={{ table: e.id }}
            search={{ page: 1, pageSize: 50 }}
            className="entity-card"
          >
            <div className="entity-name">
              <span className="muted">{e.schema}.</span>
              {e.name}
            </div>
            <div className="entity-stats">
              {e.columnCount} columns
              {e.outboundFkCount > 0 && <> &middot; {e.outboundFkCount} fk</>}
              {e.inboundRefCount > 0 && <> &middot; referenced by {e.inboundRefCount}</>}
            </div>
          </Link>
        ))}
      </div>
    </>
  )
}
