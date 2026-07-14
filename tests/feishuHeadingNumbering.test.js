// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { prepareFeishuHeadingNumbering } from "../src/content/feishuHeadingNumbering.js";
import { PRODUCTION_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

function heading(name, id = "company", numbered = false) {
  return `<div class="block docx-heading1-block" data-block-id="${id}">
    <div class="heading-block"><div class="heading heading-h1">
      ${numbered ? '<button class="heading-order">1.</button>' : ""}
      <div class="heading-content"><div contenteditable="true">${name}</div></div>
    </div></div>
  </div>`;
}

function mount(html) {
  document.body.innerHTML = `<div class="bear-web-x-container">${html}</div>`;
  const scroll = document.querySelector(".bear-web-x-container");
  Object.defineProperties(scroll, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 500 }
  });
  return scroll;
}

describe("prepareFeishuHeadingNumbering", () => {
  it("focuses the unique unnumbered root Heading 1 without dispatching keyboard events", async () => {
    mount(heading("CoFANCY 可糖"));
    const editor = document.querySelector('[contenteditable="true"]');
    const keydown = vi.fn();
    const keyup = vi.fn();
    editor.addEventListener("keydown", keydown);
    editor.addEventListener("keyup", keyup);

    await expect(prepareFeishuHeadingNumbering({
      root: document,
      url: PRODUCTION_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    })).resolves.toEqual({ ok: true, state: "prepared" });

    expect(keydown).not.toHaveBeenCalled();
    expect(keyup).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(editor);
  });

  it.each([
    ["https://zhenfund.feishu.cn/wiki/production", heading("CoFANCY 可糖"), "wrong-document"],
    [PRODUCTION_FEISHU_DOC_URL, "", "heading-missing"],
    [PRODUCTION_FEISHU_DOC_URL, heading("CoFANCY 可糖", "a") + heading("CoFANCY 可糖", "b"), "heading-duplicate"]
  ])("rejects unsafe page state %#", async (url, html, reason) => {
    mount(html);
    const result = await prepareFeishuHeadingNumbering({
      root: document,
      url,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined),
      maxSteps: 2
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it("returns an idempotent no-op for an already numbered heading", async () => {
    mount(heading("CoFANCY 可糖", "company", true));
    const result = await prepareFeishuHeadingNumbering({
      root: document,
      url: PRODUCTION_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    });
    expect(result).toEqual({ ok: true, state: "already-numbered" });
  });
});
