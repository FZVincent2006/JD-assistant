import { readFile, writeFile } from "node:fs/promises";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { applyFeishuAuthMode } from "./src/lib/manifestAuthMode.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const authMode = env.VITE_FEISHU_AUTH_MODE || "pkce";
  return {
    plugins: [react(), manifestAuthModePlugin(authMode)],
    build: {
      rollupOptions: {
        input: {
          index: "index.html",
          content: "src/content/index.js",
          background: "src/background.js"
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === "content") return "content.js";
            if (chunk.name === "background") return "background.js";
            return "assets/[name].js";
          },
          chunkFileNames: "assets/[name].js",
          assetFileNames: "assets/[name][extname]"
        }
      }
    }
  };
});

function manifestAuthModePlugin(authMode) {
  return {
    name: "feishu-auth-mode-manifest",
    async closeBundle() {
      const manifestUrl = new URL("./dist/manifest.json", import.meta.url);
      const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
      await writeFile(manifestUrl, `${JSON.stringify(applyFeishuAuthMode(manifest, authMode), null, 2)}\n`);
    }
  };
}
