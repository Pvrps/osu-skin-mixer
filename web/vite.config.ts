import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = `http://127.0.0.1:${process.env.PORT ?? "5727"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5728,
    proxy: { "/api": backend },
  },
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
