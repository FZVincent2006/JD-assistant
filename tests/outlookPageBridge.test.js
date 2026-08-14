import { describe, expect, it, vi } from "vitest";
import { createOutlookPageBridge } from "../src/lib/outlookPageBridge.js";

describe("Outlook page bridge", () => {
  it("uses the existing Outlook content-script connection when it responds", async () => {
    const chromeApi = {
      tabs: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
      scripting: { executeScript: vi.fn() }
    };
    const bridge = createOutlookPageBridge({ chromeApi });

    await expect(bridge.send(42, { type: "OUTLOOK_SCAN_REQUEST" }))
      .resolves.toEqual({ ok: true });
    expect(chromeApi.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("reinjects outlook.js once after an extension reload invalidates the old page connection", async () => {
    const chromeApi = {
      tabs: {
        sendMessage: vi.fn()
          .mockRejectedValueOnce(new Error("Receiving end does not exist"))
          .mockResolvedValueOnce({ ok: true, type: "OUTLOOK_SCAN_RESULT" })
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) }
    };
    const bridge = createOutlookPageBridge({ chromeApi });

    await expect(bridge.send(42, { type: "OUTLOOK_SCAN_REQUEST" }))
      .resolves.toMatchObject({ type: "OUTLOOK_SCAN_RESULT" });
    expect(chromeApi.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 42 },
      files: ["outlook.js"]
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
});
