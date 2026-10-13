import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell";
import { initAppearance } from "@/state/ui";
import "./index.css";

// Appearance must land before first paint, otherwise the app flashes the wrong
// theme on every launch.
initAppearance();


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // opencode owns durability in its own database, so refetching on window
      // focus mostly just duplicates the event stream.
      refetchOnWindowFocus: false,
      staleTime: 10_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  </React.StrictMode>,
);
