// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractOutlookMailRows,
  getOutlookPageState,
  startOutlookMonitor
} from "../src/content/outlookMonitor.js";

const OUTLOOK_URL = "https://partner.outlook.cn/mail/inbox";

function renderOutlook({
  folder = "个人投递（需提醒）",
  mailbox = "recruiting@zhenfund.com"
} = {}) {
  document.body.innerHTML = `
    <a href="https://microsoft365.microsoftonline.cn/?username=${mailbox}">Microsoft 365</a>
    <div role="treeitem" aria-selected="true"><span>${folder}</span></div>
    <div role="listbox">
      <div
        role="option"
        data-convid="conv-1"
        data-sender-name="Candidate"
        data-sender-email="candidate@example.com"
        data-subject="Investment internship application"
        data-received-time="2026-07-18T09:00:00+08:00"
        data-has-attachment="true"
        aria-label="未读 带附件 Candidate Investment internship application 09:00 private preview with phone 13800000000"
      >
        <span data-automationid="sender">Candidate</span>
        <span data-automationid="subject">Investment internship application</span>
        <time datetime="2026-07-18T09:00:00+08:00">09:00</time>
        <span data-automationid="preview">private preview with phone 13800000000</span>
        <span aria-label="附件">resume-private.pdf</span>
      </div>
    </div>
  `;
}

describe("extractOutlookMailRows", () => {
  beforeEach(() => {
    renderOutlook();
  });

  it("extracts only allowed fields and never returns preview or attachment names", () => {
    const rows = extractOutlookMailRows(document);

    expect(rows).toEqual([{
      conversationId: "conv-1",
      senderName: "Candidate",
      senderEmail: "candidate@example.com",
      subject: "Investment internship application",
      receivedTime: "2026-07-18T09:00:00+08:00",
      hasAttachment: true
    }]);
    expect(JSON.stringify(rows)).not.toMatch(/private preview|13800000000|resume-private\.pdf/);
  });

  it("uses sanitized fallback fields and caps their length", () => {
    document.body.innerHTML = `
      <div role="option"
        data-convid="conv-2"
        data-sender-name="${"S".repeat(300)}"
        data-subject="${"T".repeat(800)}"
        data-received-time="2026-07-18 09:30"
        aria-label="正文预览绝不能进入输出">
      </div>
    `;

    expect(extractOutlookMailRows(document)).toEqual([{
      conversationId: "conv-2",
      senderName: "S".repeat(120),
      senderEmail: "",
      subject: "T".repeat(240),
      receivedTime: "2026-07-18 09:30",
      hasAttachment: false
    }]);
  });

  it("extracts the field shape used by the live China Outlook mail list", () => {
    document.body.innerHTML = `
      <div
        role="option"
        data-convid="conv-live"
        aria-label="未读，带附件，Example Candidate，Research internship application，今天 09:30，private preview"
      >
        <div role="group">
          <span title="candidate@example.com">Example Candidate</span>
          <span title="">Research internship application</span>
          <span title="收到 2026/7/18 09:30">今天 09:30</span>
          <span>private preview</span>
        </div>
      </div>
    `;

    const rows = extractOutlookMailRows(document);

    expect(rows).toEqual([{
      conversationId: "conv-live",
      senderName: "Example Candidate",
      senderEmail: "candidate@example.com",
      subject: "Research internship application",
      receivedTime: "2026/7/18 09:30",
      hasAttachment: true
    }]);
    expect(JSON.stringify(rows)).not.toContain("private preview");
  });

  it("drops rows without a stable conversation id, subject, or received time", () => {
    document.body.innerHTML = `
      <div role="option" data-subject="No id" data-received-time="2026-07-18"></div>
      <div role="option" data-convid="no-subject" data-received-time="2026-07-18"></div>
      <div role="option" data-convid="no-time" data-subject="No time"></div>
    `;

    expect(extractOutlookMailRows(document)).toEqual([]);
  });
});

describe("getOutlookPageState", () => {
  it("recognizes the target mailbox and selected personal-delivery folder", () => {
    renderOutlook();

    expect(getOutlookPageState(document, OUTLOOK_URL)).toEqual({
      supported: true,
      mailbox: "recruiting@zhenfund.com",
      folder: "个人投递（需提醒）",
      loggedIn: true,
      targetMailbox: true,
      targetFolder: true
    });
  });

  it("uses Outlook's folder-name attribute instead of icon and unread-count text", () => {
    renderOutlook();
    const folder = document.querySelector('[role="treeitem"]');
    folder.setAttribute("data-folder-name", "个人投递（需提醒）");
    folder.textContent = "个人投递（需提醒）已选择21未读";

    expect(getOutlookPageState(document, OUTLOOK_URL)).toMatchObject({
      folder: "个人投递（需提醒）",
      targetFolder: true
    });
  });

  it("rejects a different mailbox and unsupported origin", () => {
    renderOutlook({ mailbox: "other@example.com", folder: "Inbox" });

    expect(getOutlookPageState(document, "https://outlook.office.com/mail/")).toMatchObject({
      supported: false,
      mailbox: "other@example.com",
      targetMailbox: false,
      targetFolder: false
    });
  });
});

describe("startOutlookMonitor", () => {
  it("answers scan requests with sanitized page state and rows", () => {
    renderOutlook();
    let listener;
    const chromeApi = {
      runtime: {
        onMessage: {
          addListener: vi.fn((candidate) => {
            listener = candidate;
          }),
          removeListener: vi.fn()
        },
        sendMessage: vi.fn()
      }
    };
    const observer = { observe: vi.fn(), disconnect: vi.fn() };
    const stop = startOutlookMonitor({
      root: document,
      url: OUTLOOK_URL,
      chromeApi,
      createObserver: () => observer,
      setTimer: () => 1,
      clearTimer: vi.fn()
    });
    const sendResponse = vi.fn();

    const asyncResponse = listener({ type: "OUTLOOK_SCAN_REQUEST", reason: "alarm" }, {}, sendResponse);

    expect(asyncResponse).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      type: "OUTLOOK_SCAN_RESULT",
      reason: "alarm",
      page: expect.objectContaining({
        mailbox: "recruiting@zhenfund.com",
        targetFolder: true
      }),
      mails: [expect.objectContaining({
        conversationId: "conv-1",
        subject: "Investment internship application"
      })]
    });
    stop();
    expect(observer.disconnect).toHaveBeenCalled();
    expect(chromeApi.runtime.onMessage.removeListener).toHaveBeenCalledWith(listener);
  });

  it("debounces mutation-triggered scans for three seconds", () => {
    renderOutlook();
    let mutationCallback;
    const setTimer = vi.fn(() => 9);
    const clearTimer = vi.fn();
    const chromeApi = {
      runtime: {
        onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
        sendMessage: vi.fn()
      }
    };
    startOutlookMonitor({
      root: document,
      url: OUTLOOK_URL,
      chromeApi,
      createObserver: (callback) => {
        mutationCallback = callback;
        return { observe: vi.fn(), disconnect: vi.fn() };
      },
      setTimer,
      clearTimer
    });

    mutationCallback();
    mutationCallback();

    expect(setTimer).toHaveBeenLastCalledWith(expect.any(Function), 3000);
    expect(clearTimer).toHaveBeenCalledWith(9);
  });
});
