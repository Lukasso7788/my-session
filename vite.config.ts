import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildId = String(
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "",
).slice(0, 12) || `local-${new Date().toISOString()}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __MYSESSION_BUILD_ID__: JSON.stringify(buildId),
  },
  base: "/", // пусто
  build: {
    outDir: "dist",
  },
});
