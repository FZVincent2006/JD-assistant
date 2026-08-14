import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { applyFeishuAuthMode } from "./src/lib/manifestAuthMode.js";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const authMode = env.VITE_FEISHU_AUTH_MODE || "pkce";
  return {
    plugins: [react(), ...(command === "build" ? [manifestAuthModePlugin(authMode)] : [])],
    build: {
      rollupOptions: {
        input: {
          index: "index.html",
          background: "src/background.js",
          outlook: "src/content/outlookMonitor.js"
        },
        output: {
          entryFileNames: (chunk) => {
            if (chunk.name === "background") return "background.js";
            if (chunk.name === "outlook") return "outlook.js";
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
  let root = process.cwd();
  let outDir = "dist";
  return {
    name: "feishu-auth-mode-manifest",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const outputPath = resolve(root, outDir, "manifest.json");
      const sourcePath = resolve(root, "public", "manifest.json");
      const manifest = JSON.parse(await readFile(sourcePath, "utf8"));
      await mkdir(resolve(root, outDir), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(applyFeishuAuthMode(manifest, authMode), null, 2)}\n`);
    }
  };
}
