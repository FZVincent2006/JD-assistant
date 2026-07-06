const RECORDER_KEY = "__recruitingAssistantClickRecorder";

export function startClickRecording(root = document, options = {}) {
  stopClickRecording(root);

  const state = {
    startedAt: Date.now(),
    logs: [],
    handlers: []
  };
  const events = ["pointerdown", "mousedown", "mouseup", "click", "focusin"];
  for (const eventName of events) {
    const handler = (event) => {
      state.logs.push(describeEvent(event));
    };
    root.addEventListener(eventName, handler, true);
    state.handlers.push([eventName, handler]);
  }

  const durationMs = options.durationMs ?? 30000;
  state.timer = root.defaultView?.setTimeout(() => stopClickRecording(root), durationMs);
  globalThis[RECORDER_KEY] = state;
  return { startedAt: state.startedAt, durationMs };
}

export function collectClickRecording(root = document) {
  const state = globalThis[RECORDER_KEY];
  return {
    url: root.location?.href ?? "",
    title: root.title ?? "",
    frame: {
      isTop: root.defaultView ? root.defaultView.top === root.defaultView : true,
      referrer: root.referrer ?? ""
    },
    startedAt: state?.startedAt ?? null,
    logs: state?.logs ?? []
  };
}

export function stopClickRecording(root = document) {
  const state = globalThis[RECORDER_KEY];
  if (!state) return false;

  for (const [eventName, handler] of state.handlers) {
    root.removeEventListener(eventName, handler, true);
  }
  if (state.timer) root.defaultView?.clearTimeout(state.timer);
  delete globalThis[RECORDER_KEY];
  return true;
}

function describeEvent(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return {
    type: event.type,
    time: Date.now(),
    point: {
      x: Math.round(event.clientX ?? 0),
      y: Math.round(event.clientY ?? 0)
    },
    target: describeElement(event.target),
    currentHit: describeElement(event.target?.ownerDocument?.elementFromPoint?.(event.clientX ?? 0, event.clientY ?? 0)),
    path: path
      .filter((element) => element?.nodeType === 1)
      .slice(0, 8)
      .map(describeElement)
  };
}

function describeElement(element) {
  if (!element || element.nodeType !== 1) return null;
  const rect = element.getBoundingClientRect?.();
  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
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

function selectorFor(element) {
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
