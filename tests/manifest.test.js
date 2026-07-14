import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { applyFeishuAuthMode } from "../src/lib/manifestAuthMode.js";

describe("extension manifest", () => {
  it("adds only the test-copy page permission without clipboard or debugger", () => {
    const approvedFeishuHosts = [
      "https://accounts.feishu.cn/*",
      "https://open.feishu.cn/*",
      "https://zhenfund.feishu.cn/wiki/*"
    ];
    expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite", "debugger"]));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(approvedFeishuHosts));
    expect(manifest.host_permissions.filter((host) => host.includes("feishu.cn")))
      .toEqual(approvedFeishuHosts);
    const feishuEntries = manifest.content_scripts.filter((entry) =>
      entry.matches.some((match) => match.includes("feishu.cn")));
    expect(feishuEntries).toEqual([{
      matches: ["https://zhenfund.feishu.cn/wiki/*"],
      js: ["content.js"],
      run_at: "document_idle",
      all_frames: false
    }]);
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
