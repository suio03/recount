import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  redirect,
} from '@tanstack/react-router'
import { Accounts, Shared } from './App'
import { validateSearch } from './dashboard/search'

const rootRoute = createRootRoute({
  // An unknown path opens the list of sites.
  notFoundComponent: () => <Navigate to="/" replace />,
})

const sitesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (raw: Record<string, unknown>) => raw as Record<string, string | undefined>,
  // Before paths, the view and site were in the query string (`?site=…&view=site`). Old links
  // and bookmarks land here and move to the path that replaced them.
  beforeLoad: ({ search: { site, view, ...rest } }) => {
    if (view === 'settings') throw redirect({ to: '/account', replace: true })
    if (view === 'new-site') throw redirect({ to: '/new', replace: true })
    if (site)
      throw redirect({
        to: view === 'site' ? '/sites/$domain/settings' : '/sites/$domain',
        params: { domain: site },
        search: validateSearch(rest),
        replace: true,
      })
  },
  component: () => <Accounts view="sites" />,
})

const newSiteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/new',
  component: () => <Accounts view="new-site" />,
})

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: () => <Accounts view="settings" />,
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$domain',
  validateSearch,
  component: () => <Accounts view="dashboard" />,
})

// Keeps the period and filters, so going back to the dashboard shows the same view.
const siteSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sites/$domain/settings',
  validateSearch,
  component: () => <Accounts view="site" />,
})

/** A public link: the dashboard without signing in. */
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/share/$token',
  validateSearch,
  component: () => <Shared />,
})

export const router = createRouter({
  routeTree: rootRoute.addChildren([
    sitesRoute,
    newSiteRoute,
    accountRoute,
    dashboardRoute,
    siteSettingsRoute,
    shareRoute,
  ]),
  // Plain `key=value` pairs, as before. The default would write JSON, quoting values such as a
  // page path that looks like a number.
  parseSearch: (search) => Object.fromEntries(new URLSearchParams(search)),
  stringifySearch: (search) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(search))
      if (typeof value === 'string' && value) params.set(key, value)
    const query = params.toString()
    return query ? `?${query}` : ''
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
