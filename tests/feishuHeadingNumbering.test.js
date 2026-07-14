// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyFeishuHeadingNumbering } from "../src/content/feishuHeadingNumbering.js";
import { TEST_FEISHU_DOC_URL } from "../src/lib/feishuConfig.js";

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

describe("applyFeishuHeadingNumbering", () => {
  it("focuses the unique unnumbered root Heading 1 and dispatches Command+Shift+7 exactly once", async () => {
    mount(heading("CoFANCY 可糖"));
    const editor = document.querySelector('[contenteditable="true"]');
    const events = [];
    editor.addEventListener("keydown", (event) => {
      events.push([event.type, event.key, event.code, event.metaKey, event.shiftKey]);
      document.querySelector(".heading").insertAdjacentHTML("afterbegin", '<button class="heading-order">1.</button>');
    });
    editor.addEventListener("keyup", (event) => events.push([event.type, event.key, event.code, event.metaKey, event.shiftKey]));

    await expect(applyFeishuHeadingNumbering({
      root: document,
      url: TEST_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    })).resolves.toEqual({ ok: true });

    expect(events).toEqual([
      ["keydown", "7", "Digit7", true, true],
      ["keyup", "7", "Digit7", true, true]
    ]);
    expect(document.activeElement).toBe(editor);
  });

  it.each([
    ["https://zhenfund.feishu.cn/wiki/production", heading("CoFANCY 可糖"), "wrong-document"],
    [TEST_FEISHU_DOC_URL, "", "heading-missing"],
    [TEST_FEISHU_DOC_URL, heading("CoFANCY 可糖", "a") + heading("CoFANCY 可糖", "b"), "heading-duplicate"],
    [TEST_FEISHU_DOC_URL, heading("CoFANCY 可糖", "a", true), "already-numbered"]
  ])("rejects unsafe page state %#", async (url, html, reason) => {
    mount(html);
    const result = await applyFeishuHeadingNumbering({
      root: document,
      url,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined),
      maxSteps: 2
    });
    expect(result).toMatchObject({ ok: false, reason });
  });

  it("reports shortcut rejection without dispatching a second shortcut", async () => {
    mount(heading("CoFANCY 可糖"));
    const editor = document.querySelector('[contenteditable="true"]');
    const keydown = vi.fn();
    editor.addEventListener("keydown", keydown);
    const result = await applyFeishuHeadingNumbering({
      root: document,
      url: TEST_FEISHU_DOC_URL,
      companyName: "CoFANCY 可糖",
      settle: vi.fn().mockResolvedValue(undefined)
    });
    expect(result).toMatchObject({ ok: false, reason: "shortcut-rejected" });
    expect(keydown).toHaveBeenCalledTimes(1);
  });
});
