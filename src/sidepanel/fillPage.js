const MESSAGE_TYPE = "RECRUITING_ASSISTANT_FILL";
const DIAGNOSE_MESSAGE_TYPE = "RECRUITING_ASSISTANT_DIAGNOSE";
const RECORD_START_MESSAGE_TYPE = "RECRUITING_ASSISTANT_RECORD_START";
const RECORD_COLLECT_MESSAGE_TYPE = "RECRUITING_ASSISTANT_RECORD_COLLECT";
const RECEIVER_MISSING = "Receiving end does not exist";
const SUPPORTED_URL = /^https:\/\/([^/]+\.)?(zhipin|kanzhun|maimai)\.(com|cn)\//;

export async function sendFillRequest(payload, platform, chromeApi = chrome) {
  const tab = await getActiveTab(chromeApi);
  if (!tab?.id || !isSupportedTab(tab.url)) {
    return {
      ok: false,
      error: "请先切到脉脉或 Boss 发布职位页面，再点击填入当前页面。"
    };
  }

  const message = { type: MESSAGE_TYPE, platform: platformForUrl(tab.url) ?? platform, payload };

  try {
    const response = await chromeApi.tabs.sendMessage(tab.id, message);
    if (!shouldTryChildFrames(response, message.platform)) return response;
    const frameResponse = await sendToChildFrames(tab.id, message, chromeApi);
    return frameResponse ?? response;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      return { ok: false, error: readableError(error) };
    }
  }

  try {
    await injectContentScript(tab.id, chromeApi);
    const response = await chromeApi.tabs.sendMessage(tab.id, message);
    if (!shouldTryChildFrames(response, message.platform)) return response;
    const frameResponse = await sendToChildFrames(tab.id, message, chromeApi);
    return frameResponse ?? response;
  } catch (error) {
    return {
      ok: false,
      error: `无法连接到当前页面，请刷新发布页后重试。${readableError(error)}`
    };
  }
}

export async function sendDiagnosticRequest(chromeApi = chrome) {
  const tab = await getActiveTab(chromeApi);
  if (!tab?.id || !isSupportedTab(tab.url)) {
    return {
      ok: false,
      error: "请先切到脉脉或 Boss 发布职位页面，再点击诊断当前页面。"
    };
  }

  const message = { type: DIAGNOSE_MESSAGE_TYPE };
  const diagnostics = [];
  const topResponse = await sendDiagnosticToTarget(tab.id, message, chromeApi);
  if (topResponse?.ok) diagnostics.push({ frameId: 0, ...topResponse.diagnostics });

  const frames = await chromeApi.webNavigation?.getAllFrames?.({ tabId: tab.id });
  const childFrames = (frames ?? []).filter((frame) => frame.frameId && isSupportedTab(frame.url));
  for (const frame of childFrames) {
    const response = await sendDiagnosticToTarget(tab.id, message, chromeApi, frame.frameId);
    if (response?.ok) diagnostics.push({ frameId: frame.frameId, ...response.diagnostics });
  }

  if (!diagnostics.length) {
    return { ok: false, error: "没有拿到页面诊断信息，请刷新发布页后重试。" };
  }

  return { ok: true, diagnostics };
}

export async function startClickRecording(chromeApi = chrome) {
  const tab = await getActiveSupportedTab(chromeApi, "请先切到脉脉或 Boss 发布职位页面。");
  if (!tab.ok) return tab;

  const durationMs = 45000;
  const results = await chromeApi.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    world: "MAIN",
    func: startRecorderInPage,
    args: [durationMs]
  });

  return {
    ok: true,
    responses: results.map((item) => ({ frameId: item.frameId, recording: item.result }))
  };
}

export async function collectClickRecording(chromeApi = chrome) {
  const tab = await getActiveSupportedTab(chromeApi, "请先切到脉脉或 Boss 发布职位页面。");
  if (!tab.ok) return tab;

  const results = await chromeApi.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    world: "MAIN",
    func: collectRecorderInPage
  });

  return {
    ok: true,
    responses: results.map((item) => ({ frameId: item.frameId, recording: item.result }))
  };
}

async function sendDiagnosticToTarget(tabId, message, chromeApi, frameId) {
  try {
    return await chromeApi.tabs.sendMessage(tabId, message, frameId == null ? undefined : { frameId });
  } catch (error) {
    if (!isMissingReceiverError(error)) return null;
  }

  try {
    await injectContentScript(tabId, chromeApi, frameId);
    return await chromeApi.tabs.sendMessage(tabId, message, frameId == null ? undefined : { frameId });
  } catch {
    return null;
  }
}

function shouldTryChildFrames(response, platform) {
  return platform === "boss" && response?.ok && (response.filled?.length ?? 0) === 0 && (response.missing?.length ?? 0) > 0;
}

async function sendToChildFrames(tabId, message, chromeApi) {
  const frames = await chromeApi.webNavigation?.getAllFrames?.({ tabId });
  const childFrames = (frames ?? []).filter((frame) => frame.frameId && isSupportedTab(frame.url));
  if (!childFrames.length) return null;

  let fallback = null;
  for (const frame of childFrames) {
    const response = await sendToFrame(tabId, frame.frameId, message, chromeApi);
    if (response?.ok && (response.filled?.length ?? 0) > 0) return response;
    fallback ??= response;
  }

  return fallback;
}

async function sendToFrame(tabId, frameId, message, chromeApi) {
  try {
    return await chromeApi.tabs.sendMessage(tabId, message, { frameId });
  } catch (error) {
    if (!isMissingReceiverError(error)) return null;
  }

  try {
    await injectContentScript(tabId, chromeApi, frameId);
    return await chromeApi.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // Some frames may not allow content scripts; keep trying other frames.
    return null;
  }
}

async function injectContentScript(tabId, chromeApi, frameId) {
  const target = frameId == null ? { tabId } : { tabId, frameIds: [frameId] };
  await chromeApi.scripting.executeScript({
    target,
    files: ["content.js"]
  });
}

async function getActiveTab(chromeApi) {
  const [tab] = await chromeApi.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getActiveSupportedTab(chromeApi, error) {
  const tab = await getActiveTab(chromeApi);
  if (!tab?.id || !isSupportedTab(tab.url)) return { ok: false, error };
  return { ok: true, id: tab.id, url: tab.url };
}

function isSupportedTab(url = "") {
  return SUPPORTED_URL.test(url);
}

function platformForUrl(url = "") {
  if (/https:\/\/([^/]+\.)?(zhipin|kanzhun)\.(com|cn)\//.test(url)) return "boss";
  if (/https:\/\/([^/]+\.)?maimai\.(com|cn)\//.test(url)) return "maimai";
  return "";
}

function isMissingReceiverError(error) {
  return readableError(error).includes(RECEIVER_MISSING);
}

function readableError(error) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function startRecorderInPage(durationMs) {
  const key = "__recruitingAssistantInjectedClickRecorder";
  const existing = globalThis[key];
  if (existing) {
    for (const [eventName, handler] of existing.handlers) {
      document.removeEventListener(eventName, handler, true);
    }
    if (existing.timer) clearTimeout(existing.timer);
  }

  const state = {
    startedAt: Date.now(),
    logs: [],
    handlers: []
  };
  const events = ["pointerdown", "mousedown", "mouseup", "click", "focusin"];
  for (const eventName of events) {
    const handler = (event) => {
      state.logs.push(describeRecordedEvent(event));
    };
    document.addEventListener(eventName, handler, true);
    state.handlers.push([eventName, handler]);
  }
  state.timer = setTimeout(() => {
    for (const [eventName, handler] of state.handlers) {
      document.removeEventListener(eventName, handler, true);
    }
  }, durationMs);
  globalThis[key] = state;
  return { startedAt: state.startedAt, durationMs };

  function describeRecordedEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    return {
      type: event.type,
      time: Date.now(),
      point: {
        x: Math.round(event.clientX ?? 0),
        y: Math.round(event.clientY ?? 0)
      },
      target: describeRecordedElement(event.target),
      currentHit: describeRecordedElement(event.target?.ownerDocument?.elementFromPoint?.(event.clientX ?? 0, event.clientY ?? 0)),
      path: path
        .filter((element) => element?.nodeType === 1)
        .slice(0, 8)
        .map(describeRecordedElement)
    };
  }

  function describeRecordedElement(element) {
    if (!element || element.nodeType !== 1) return null;
    const rect = element.getBoundingClientRect?.();
    return {
      tag: element.tagName.toLowerCase(),
      selector: recordedSelectorFor(element),
      id: element.id || "",
      className: String(element.className || ""),
      role: element.getAttribute("role") || "",
      placeholder: element.getAttribute("placeholder") || "",
      value: element.value || "",
      text: String(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120),
      rect: rect
        ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        : null
    };
  }

  function recordedSelectorFor(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let node = element;
    for (let depth = 0; depth < 5 && node && node.nodeType === 1 && node.tagName !== "BODY"; depth += 1) {
      let part = node.tagName.toLowerCase();
      const classNames = String(node.className || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3);
      if (classNames.length) part += `.${classNames.map((name) => CSS.escape(name)).join(".")}`;
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }
}

function collectRecorderInPage() {
  const key = "__recruitingAssistantInjectedClickRecorder";
  const state = globalThis[key];
  const recording = {
    url: location.href,
    title: document.title,
    frame: {
      isTop: top === window,
      referrer: document.referrer
    },
    startedAt: state?.startedAt ?? null,
    logs: state?.logs ?? []
  };

  if (state) {
    for (const [eventName, handler] of state.handlers) {
      document.removeEventListener(eventName, handler, true);
    }
    if (state.timer) clearTimeout(state.timer);
    delete globalThis[key];
  }

  return recording;
}
