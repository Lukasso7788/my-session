import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { publicDesktopAuthConfig } from "./scripts/desktop-auth-config.mjs";
let desktopPublicEnv: Record<string, string> = {};

const buildId = String(
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "",
).slice(0, 12) || `local-${new Date().toISOString()}`;

export default defineConfig({
  plugins: [react(), {
    name: "public-desktop-auth-config",
    configResolved(config) { desktopPublicEnv = config.env; },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "desktop-auth-config.json", source: JSON.stringify(publicDesktopAuthConfig(desktopPublicEnv)) });
    },
  }],
  define: {
    __MYSESSION_BUILD_ID__: JSON.stringify(buildId),
  },
  base: "/", // пусто
  build: {
    outDir: "dist",
    rollupOptions: {
      // The app, plus the standalone /host-guide page (src/hostGuide/main.tsx).
      input: {
        main: "index.html",
        hostGuide: "host-guide/index.html",
      },
    },
  },
});
