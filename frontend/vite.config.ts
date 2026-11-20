import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { host: "localhost", port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks so app changes don't invalidate the large libraries.
        manualChunks: {
          react: ["react", "react-dom", "react-dom/client", "react-router-dom", "@tanstack/react-query"],
          recharts: ["recharts"],
          motion: ["motion", "gsap", "gsap/ScrollTrigger"],
          radix: ["radix-ui"],
        },
      },
    },
  },
});
