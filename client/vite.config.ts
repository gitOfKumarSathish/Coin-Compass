import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig(({ mode }) => {
  // Load .env[.mode] files from this dir so VITE_ vars are available in the config.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const apiProxy = env.VITE_API_PROXY ?? process.env.VITE_API_PROXY ?? "http://localhost:4000";

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        // favicon.svg is already in /public; list the icons the manifest points at.
        includeAssets: ["favicon.svg", "apple-touch-icon.png"],
        manifest: {
          id: "/",
          name: "CoinCompass — Personal Finance Manager",
          short_name: "CoinCompass",
          description: "Track spending, budgets, goals, loans, and net worth.",
          start_url: "/",
          scope: "/",
          display: "standalone",
          orientation: "portrait",
          theme_color: "#0F172A",
          background_color: "#0F172A",
          icons: [
            { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/maskable-icon-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
          // Serve index.html for client-side routes, but never shadow the API or
          // OAuth callbacks — those must hit the network / server directly.
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api/],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
        },
        // Register the service worker in `vite dev` too, so the app is
        // installable during development (not just in production builds).
        devOptions: { enabled: true, type: "module", navigateFallback: "index.html" },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true, // expose on the local network (0.0.0.0) — prints a Network URL
      port: 5173,
      strictPort: true, // OAuth redirect URIs are exact, so silently shifting ports breaks sign-in.
      proxy: {
        "/api": {
          // Keep /api on the same browser origin as the app so auth cookies and
          // OAuth callbacks round-trip through the Vite proxy consistently.
          target: apiProxy,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Only libraries the app shell itself needs on first paint belong
          // here. Naming a library in manualChunks makes Vite preload its chunk
          // from index.html even when nothing in the entry graph imports it —
          // recharts used to be listed and cost every visitor ~115 kB gzip on
          // the login page. Left unlisted, it lands in a shared chunk that only
          // the chart pages pull in.
          manualChunks: {
            react: ["react", "react-dom", "react-router-dom"],
            motion: ["motion"],
            query: ["@tanstack/react-query"],
          },
        },
      },
    },
  };
});
