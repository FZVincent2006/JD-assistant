import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appPath = fileURLToPath(new URL("../src/sidepanel/App.jsx", import.meta.url));

describe("reduced side panel", () => {
  it("offers only Boss and Maimai modes", async () => {
    const source = await readFile(appPath, "utf8");
    expect(source).toContain('useState("maimai")');
    expect(source).toContain('onClick={() => setPlatform("boss")}');
    expect(source).not.toContain('setPlatform("feishu")');
    expect(source).not.toContain('setPlatform("outlook")');
    expect(source).not.toContain("OutlookMonitorPanel");
    expect(source).not.toContain("parseCompanyJdBatch");
  });
});
