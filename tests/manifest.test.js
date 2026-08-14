import { describe, expect, it } from "vitest";
import manifest from "../public/manifest.json";
import { applyFeishuAuthMode } from "../src/lib/manifestAuthMode.js";

describe("extension manifest", () => {
  it("identifies the Outlook rich-mail reminder release version", () => {
    expect(manifest.version).toBe("0.3.16");
  });

  it("uses Feishu API permissions without injecting a script into Feishu pages", () => {
    const approvedFeishuHosts = [
      "https://accounts.feishu.cn/*",
      "https://open.feishu.cn/*"
    ];
    expect(manifest.permissions).toEqual(expect.arrayContaining(["identity", "storage"]));
    expect(manifest.permissions).not.toEqual(expect.arrayContaining(["clipboardRead", "clipboardWrite", "debugger"]));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(approvedFeishuHosts));
    expect(manifest.host_permissions.filter((host) => host.includes("feishu.cn")))
      .toEqual(approvedFeishuHosts);
    const feishuEntries = manifest.content_scripts.filter((entry) =>
      entry.matches.some((match) => match.includes("feishu.cn")));
    expect(feishuEntries).toEqual([]);
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

  it("wires a dedicated China Outlook monitor with local-only state permissions", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining([
      "storage", "alarms", "notifications", "downloads"
    ]));
    expect(manifest.host_permissions).toEqual(expect.arrayContaining([
      "https://partner.outlook.cn/*",
      "https://open.feishu.cn/*"
    ]));
    expect(manifest.host_permissions.some((host) => host.includes("microsoftgraph"))).toBe(false);
    expect(manifest.content_scripts).toContainEqual(expect.objectContaining({
      matches: ["https://partner.outlook.cn/mail/*"],
      js: ["outlook.js"],
      run_at: "document_idle",
      all_frames: false
    }));
  });
});
