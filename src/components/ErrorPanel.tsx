import { Link } from '@tanstack/react-router'

/**
 * Route-level error UI. Rendered inside the app shell's <Outlet>, so the header
 * and breadcrumb remain. Announced to assistive tech and offers a recovery path.
 */
export function ErrorPanel({ error }: { error: Error }) {
  return (
    <>
      <div className="toolbar">
        <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Something went wrong</h1>
      </div>
      <div className="error-box" role="alert">
        {error?.message ?? 'Unknown error'}
      </div>
      <p style={{ marginTop: '1rem' }}>
        <Link to="/">&larr; Back to tables</Link>
      </p>
    </>
  )
}
