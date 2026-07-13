import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { applyFeishuAuthMode } from "../src/lib/manifestAuthMode.js";

describe("extension manifest", () => {
  it("grants clipboard and ZhenFund Feishu access without debugger permission", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite"]));
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.host_permissions).toContain("https://zhenfund.feishu.cn/*");
    expect(manifest.content_scripts[0].matches).toContain("https://zhenfund.feishu.cn/*");
  });

  it("adds nativeMessaging only to native auth builds", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
    expect(applyFeishuAuthMode(manifest, "native").permissions).toContain("nativeMessaging");
    expect(applyFeishuAuthMode(manifest, "pkce").permissions).not.toContain("nativeMessaging");
  });
});
