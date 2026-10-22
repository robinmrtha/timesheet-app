import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { apiDevPlugin } from "./server/vite-plugin.js";

export default defineConfig({
  base: "/timesheet/",
  plugins: [react(), apiDevPlugin()],
  server: { port: 5173 },
});
