import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppNavigator } from './src/navigation/AppNavigator';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once on failure — avoids hammering the backend on hard errors
      // while still recovering from transient network blips.
      retry: 1,
      // Keep data fresh for 30 s — sufficient for trip/booking polling without
      // causing stale-reads in fast UX flows.
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </QueryClientProvider>
  );
}
