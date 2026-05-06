import { defineConfig } from "nitro";

export default defineConfig({
  preset: "vercel",
  serverDir: "./server",
  compatibilityDate: "2026-05-06",
  watchOptions: {
    ignored: ["**/.vercel/**", "**/.nitro/**", "**/.output/**", "**/.next/**", "**/node_modules/**"],
  },
});
