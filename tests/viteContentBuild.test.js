import { describe, expect, it } from "vitest";
import packageJson from "../package.json";
import contentBuildConfig from "../vite.content.config.js";

describe("content-script production build", () => {
  it("builds the content entry separately as one self-contained classic script", () => {
    expect(packageJson.scripts.build).toContain("vite build --config vite.content.config.js");
    expect(contentBuildConfig).toMatchObject({
      publicDir: false,
      build: {
        emptyOutDir: false,
        rollupOptions: {
          input: "src/content/index.js",
          output: {
            format: "iife",
            inlineDynamicImports: true,
            entryFileNames: "content.js"
          }
        }
      }
    });
  });
});
