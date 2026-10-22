import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError, setUnauthenticatedHandler } from './lib/api/client';
import './lib/i18n';
import { NotFound } from './routes/__root';
import { routeTree } from './routeTree.gen';
import './styles.css';

// ARCHITECTURE §5: never retry 4xx; one retry for network errors and 5xx; mutations never retry.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (count, error) => count < 1 && !(error instanceof ApiError && error.status < 500),
    },
    mutations: { retry: false },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
});

// A 401 after sign-in clears the cache and returns to sign-in (ARCHITECTURE §3).
setUnauthenticatedHandler(() => {
  queryClient.clear();
  void router.navigate({ to: '/sign-in', search: { redirect: router.state.location.href } });
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
