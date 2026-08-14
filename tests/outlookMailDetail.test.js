// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  extractOpenOutlookMail,
  readOutlookMailViaGui,
  triggerOutlookAttachmentDownload
} from "../src/content/outlookMailDetail.js";

function renderOpenMail() {
  document.body.innerHTML = `
    <div role="option" data-convid="conv-1">Candidate row</div>
    <section data-app-section="MailReadCompose">
      <h1 role="heading">Investment internship application</h1>
      <div id="UniqueMessageBody_1">
        Hello team\nPlease see my resume.
      </div>
      <a
        data-automationid="attachment-item"
        data-attachment-id="attachment-1"
        download="Candidate Resume.pdf"
        href="https://partner.outlook.cn/attachment/resume.pdf"
      >Candidate Resume.pdf 2 KB</a>
    </section>
  `;
}

describe("Outlook GUI mail detail", () => {
  it("extracts the visible body and attachment link only after the subject matches", () => {
    renderOpenMail();

    expect(extractOpenOutlookMail(document, {
      subject: "Investment internship application"
    })).toMatchObject({
      subject: "Investment internship application",
      body: "Hello team\nPlease see my resume.",
      bodyTruncated: false,
      attachments: [{
        id: "attachment-1",
        name: "Candidate Resume.pdf",
        url: "https://partner.outlook.cn/attachment/resume.pdf",
        size: 2 * 1024
      }]
    });
    expect(extractOpenOutlookMail(document, { subject: "Another application" })).toBeNull();
  });

  it("clicks the exact new-mail row before reading the visible detail", async () => {
    document.body.innerHTML = `
      <div role="option" data-convid="conv-1">Candidate row</div>
    `;
    const row = document.querySelector('[data-convid="conv-1"]');
    row.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `
        <section data-app-section="MailReadCompose">
          <h1 role="heading">Investment internship application</h1>
          <div data-testid="message-body">Visible body</div>
        </section>
      `);
    });

    await expect(readOutlookMailViaGui({
      root: document,
      mail: {
        conversationId: "conv-1",
        subject: "Investment internship application"
      }
    })).resolves.toMatchObject({ body: "Visible body" });
  });

  it("does not click the selected row again when the requested mail is already open", async () => {
    renderOpenMail();
    const row = document.querySelector('[data-convid="conv-1"]');
    const click = vi.spyOn(row, "click");

    await expect(readOutlookMailViaGui({
      root: document,
      mail: {
        conversationId: "conv-1",
        subject: "Investment internship application"
      }
    })).resolves.toMatchObject({ body: "Hello team\nPlease see my resume." });
    expect(click).not.toHaveBeenCalled();
  });

  it("clicks the subject target when Outlook only opens mail from the inner row control", async () => {
    document.body.innerHTML = `
      <div role="option" data-convid="conv-1">
        <span data-automationid="subject">Investment internship application</span>
      </div>
    `;
    const subject = document.querySelector('[data-automationid="subject"]');
    subject.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `
        <section data-app-section="MailReadCompose">
          <h1 role="heading">Investment internship application</h1>
          <div id="UniqueMessageBody_2">Actual body</div>
        </section>
      `);
    });

    await expect(readOutlookMailViaGui({
      root: document,
      mail: {
        conversationId: "conv-1",
        subject: "Investment internship application"
      }
    })).resolves.toMatchObject({ body: "Actual body" });
  });

  it("rejects a generic document outside the real Outlook reading pane", () => {
    document.body.innerHTML = `
      <div role="heading">Investment internship application</div>
      <div data-app-section="MailReadCompose"><div role="document">Mail list text</div></div>
    `;

    expect(extractOpenOutlookMail(document, {
      subject: "Investment internship application"
    })).toBeNull();
  });

  it("reports a visible resume control without a download URL as skipped", () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Investment internship application</h1>
        <div id="UniqueMessageBody_3">Actual body</div>
        <button aria-label="下载 Candidate Resume.pdf">Candidate Resume.pdf</button>
      </section>
    `;

    expect(extractOpenOutlookMail(document, {
      subject: "Investment internship application"
    })).toMatchObject({
      attachments: [],
      skippedAttachments: [{ name: "Candidate Resume.pdf", reason: "no-download-url" }]
    });
  });

  it("excludes quoted reply history and filenames inside the message body", () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Application reply</h1>
        <div id="UniqueMessageBody_4">
          Please see my current resume.
          <div id="divRplyFwdMsg">发件人：HR</div>
          <div>Previous reply and Old Resume.pdf</div>
        </div>
      </section>
    `;

    expect(extractOpenOutlookMail(document, { subject: "Application reply" })).toMatchObject({
      body: "Please see my current resume.",
      attachments: [],
      skippedAttachments: []
    });
  });

  it("removes Outlook-injected style rules from the visible message text", () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Styled application</h1>
        <div id="UniqueMessageBody_6">
          <style>.rps_ed3c font { line-height: 1.6 }</style>
          Hello recruiting team.
        </div>
      </section>
    `;

    expect(extractOpenOutlookMail(document, { subject: "Styled application" })).toMatchObject({
      body: "Hello recruiting team."
    });
  });

  it("finds an attachment bar above the current message container", () => {
    document.body.innerHTML = `
      <main data-testid="mail-reading-pane">
        <a class="attachment-item" download="Candidate.pdf"
          href="https://partner.outlook.cn/attachment/candidate.pdf">Candidate.pdf</a>
        <section data-app-section="MailReadCompose">
          <h1 role="heading">Nested application</h1>
          <div id="UniqueMessageBody_7">Hello team</div>
        </section>
      </main>
    `;

    expect(extractOpenOutlookMail(document, { subject: "Nested application" })).toMatchObject({
      attachments: [{ name: "Candidate.pdf" }],
      skippedAttachments: []
    });
  });

  it("does not mistake an Outlook preview URL for the real attachment", async () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Application with attachment</h1>
        <button aria-label="Candidate Resume.pdf">Candidate Resume.pdf</button>
        <div id="UniqueMessageBody_5">Hello team</div>
      </section>
    `;
    document.querySelector("button").addEventListener("click", () => {
      document.querySelector("section").insertAdjacentHTML(
        "beforeend",
        '<iframe src="blob:https://partner.outlook.cn/resume-preview"></iframe>'
      );
    });

    const row = document.createElement("div");
    row.setAttribute("role", "option");
    row.setAttribute("data-convid", "conv-preview");
    row.innerHTML = '<span data-automationid="subject">Application with attachment</span>';
    document.body.prepend(row);

    await expect(readOutlookMailViaGui({
      root: document,
      mail: { conversationId: "conv-preview", subject: "Application with attachment" }
    })).resolves.toMatchObject({
      attachments: [],
      skippedAttachments: [{ name: "Candidate Resume.pdf", reason: "no-download-url" }]
    });
  });

  it("keeps a generated preview separate from the real download flow", async () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Generated attachment</h1>
        <button aria-label="下载 Candidate Resume.pdf">Candidate Resume.pdf</button>
        <div id="UniqueMessageBody_8">Hello team</div>
      </section>
    `;
    document.querySelector("button").addEventListener("click", () => {
      const captureId = document.documentElement.getAttribute("data-jd-assistant-capture-id");
      window.postMessage({
        source: "jd-assistant-outlook-attachment",
        captureId,
        name: "Candidate Resume.pdf",
        url: "blob:https://partner.outlook.cn/generated-resume"
      }, window.location.origin);
    });

    const row = document.createElement("div");
    row.setAttribute("role", "option");
    row.setAttribute("data-convid", "conv-generated");
    row.innerHTML = '<span data-automationid="subject">Generated attachment</span>';
    document.body.prepend(row);

    await expect(readOutlookMailViaGui({
      root: document,
      mail: { conversationId: "conv-generated", subject: "Generated attachment" }
    })).resolves.toMatchObject({
      attachments: [],
      skippedAttachments: [{ name: "Candidate Resume.pdf", reason: "no-download-url" }]
    });
  });

  it("opens Outlook's plain-text attachment tile menu and clicks Download", async () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Plain attachment tile</h1>
        <div class="outlook-file-tile">
          <span>Candidate Resume.pdf</span><span>494 KB</span>
          <button type="button" aria-label="更多操作">⌄</button>
        </div>
        <div id="UniqueMessageBody_9">Hello team</div>
      </section>
    `;
    let downloadClicks = 0;
    const clickSequence = [];
    document.querySelector(".outlook-file-tile").addEventListener("click", (event) => {
      if (event.target.closest('[aria-label="更多操作"]')) return;
      const captureId = document.documentElement.getAttribute("data-jd-assistant-capture-id");
      window.postMessage({
        source: "jd-assistant-outlook-attachment",
        captureId,
        name: "Candidate Resume.pdf",
        url: "blob:https://partner.outlook.cn/preview-stub"
      }, window.location.origin);
    });
    document.querySelector('[aria-label="更多操作"]').addEventListener("click", () => {
      const action = document.createElement("div");
      action.className = "fluent-menu-row-without-role";
      action.innerHTML = "<span>下载</span>";
      action.addEventListener("click", () => clickSequence.push("click"));
      action.addEventListener("click", () => {
        downloadClicks += 1;
      });
      document.body.append(action);
    });

    const row = document.createElement("div");
    row.setAttribute("role", "option");
    row.setAttribute("data-convid", "conv-plain-tile");
    row.innerHTML = '<span data-automationid="subject">Plain attachment tile</span>';
    document.body.prepend(row);

    await expect(triggerOutlookAttachmentDownload({
      root: document,
      mail: { conversationId: "conv-plain-tile", subject: "Plain attachment tile" },
      name: "Candidate Resume.pdf"
    })).resolves.toMatchObject({ ok: true, name: "Candidate Resume.pdf" });
    expect(downloadClicks).toBe(1);
    expect(clickSequence).toEqual(["click"]);
  });

  it("finds an attachment tile rendered outside the subject and body container", async () => {
    document.body.innerHTML = `
      <main data-testid="mail-reading-pane">
        <section class="message-text">
          <h1 role="heading">Detached attachment tile</h1>
          <div id="UniqueMessageBody_10">Hello team</div>
        </section>
        <aside class="outlook-file-tile">
          <span>Detached Resume.pdf</span><span>494 KB</span>
          <button type="button" aria-label="更多操作">⌄</button>
        </aside>
      </main>
    `;
    let downloadClicks = 0;
    document.querySelector('[aria-label="更多操作"]').addEventListener("click", () => {
      const action = document.createElement("div");
      action.setAttribute("role", "menuitem");
      action.textContent = "下载";
      action.addEventListener("click", () => { downloadClicks += 1; });
      document.body.append(action);
    });

    await expect(triggerOutlookAttachmentDownload({
      root: document,
      mail: { conversationId: "conv-detached", subject: "Detached attachment tile" },
      name: "Detached Resume.pdf"
    })).resolves.toMatchObject({ ok: true, name: "Detached Resume.pdf" });
    expect(downloadClicks).toBe(1);
  });

  it("recognizes a large inline image as a resume attachment", () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Image resume</h1>
        <div id="UniqueMessageBody_11">
          Hello recruiting team.
          <img src="blob:https://partner.outlook.cn/resume-image" width="800" height="1100">
        </div>
      </section>
    `;

    expect(extractOpenOutlookMail(document, {
      subject: "Image resume",
      hasAttachment: true
    })).toMatchObject({
      body: "Hello recruiting team.",
      attachments: [],
      skippedAttachments: [{
        name: "邮件图片简历-1.png",
        reason: "inline-image",
        kind: "inline-image"
      }]
    });
  });

  it("recognizes Outlook's interactive image attachment card inside the body", () => {
    document.body.innerHTML = `
      <section data-app-section="MailReadCompose">
        <h1 role="heading">Image card resume</h1>
        <div id="UniqueMessageBody_12">
          <div class="image-attachment-card" role="button" tabindex="0">
            <span>BD73D418@F600D213.01D57B6A00000000.png</span>
            <button aria-label="更多操作">⌄</button>
          </div>
          <p>Hello recruiting team.</p>
        </div>
      </section>
    `;

    expect(extractOpenOutlookMail(document, {
      subject: "Image card resume",
      hasAttachment: true
    })).toMatchObject({
      body: "Hello recruiting team.",
      attachments: [],
      skippedAttachments: [{
        name: "BD73D418@F600D213.01D57B6A00000000.png",
        reason: "no-download-url"
      }]
    });
  });

});
