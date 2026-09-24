import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));

describe("reduced extension manifest", () => {
  it("keeps only permissions and host matches required by Boss and Maimai", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.background).toBeUndefined();
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "sidePanel", "tabs", "webNavigation"]);
    expect(manifest.host_permissions.join(" ")).not.toMatch(/feishu|outlook/i);
    expect(manifest.content_scripts).toHaveLength(1);
    expect(manifest.content_scripts[0].matches.join(" ")).toMatch(/zhipin|maimai/);
  });
});
