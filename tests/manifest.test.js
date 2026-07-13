import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { applyFeishuAuthMode } from "../src/lib/manifestAuthMode.js";

describe("extension manifest", () => {
  it("uses OpenAPI permissions without clipboard, debugger, or Feishu page injection", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite", "debugger"]));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      "https://accounts.feishu.cn/*",
      "https://open.feishu.cn/*"
    ]));
    expect(manifest.host_permissions).not.toContain("https://zhenfund.feishu.cn/*");
    expect(manifest.content_scripts[0].matches.some((match) => match.includes("feishu.cn"))).toBe(false);
  });

  it("preserves every existing Boss and Maimai host and content-script match", () => {
    const recruitingHosts = [
      "https://*.zhipin.com/*",
      "https://*.kanzhun.com/*",
      "https://maimai.cn/*",
      "https://*.maimai.cn/*",
      "https://maimai.com/*",
      "https://*.maimai.com/*"
    ];
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(recruitingHosts));
    expect(manifest.content_scripts[0].matches).toEqual(expect.arrayContaining(recruitingHosts));
  });

  it("adds nativeMessaging only to native auth builds", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
    expect(applyFeishuAuthMode(manifest, "native").permissions).toContain("nativeMessaging");
    expect(applyFeishuAuthMode(manifest, "pkce").permissions).not.toContain("nativeMessaging");
  });
});
