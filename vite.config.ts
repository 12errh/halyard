import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

/**
 * Vite stamps `crossorigin` onto the emitted module script and stylesheet.
 * On Tauri's custom protocol WebKitGTK treats that as a CORS request against a
 * scheme that has no CORS headers, and the whole bundle silently fails to
 * execute. Stripping it is the standard fix.
 */
function stripCrossOrigin() {
  return {
    name: "halyard-strip-crossorigin",
    enforce: "post" as const,
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin(?=[=\s>])/g, "");
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stripCrossOrigin()],

  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // WebKitGTK on Linux tops out below the Chromium bundle ceiling, and streaming
    // token deltas make long runs janky if a chunk balloons.
    target: "es2022",
    chunkSizeWarningLimit: 900,
  },
});
