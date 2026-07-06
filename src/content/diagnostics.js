const TARGET_LABELS = ["经验", "学历"];
const CONTROL_SELECTOR = [
  "input",
  "button",
  "[role='button']",
  "[aria-haspopup]",
  "[aria-expanded]",
  "[class*='select']",
  "[class*='Select']",
  "[class*='picker']",
  "[class*='Picker']",
  "div",
  "span",
  "i",
  "svg"
].join(",");

export function collectPageDiagnostics(root = document) {
  return {
    url: root.location?.href ?? "",
    title: root.title ?? "",
    frame: frameInfo(root),
    viewport: {
      width: root.defaultView?.innerWidth ?? 0,
      height: root.defaultView?.innerHeight ?? 0,
      scrollX: root.defaultView?.scrollX ?? 0,
      scrollY: root.defaultView?.scrollY ?? 0
    },
    labels: TARGET_LABELS.map((label) => inspectLabel(label, root)),
    visiblePopups: findVisiblePopupLikeElements(root).map(describeElement)
  };
}

function inspectLabel(label, root) {
  const labelNode = findExactText(label, root);
  if (!labelNode) return { label, found: false };

  const ancestors = [];
  let node = labelNode;
  for (let depth = 0; depth < 5 && node && node !== root.body; depth += 1) {
    ancestors.push(describeElement(node));
    node = node.parentElement;
  }

  const searchRoot = ancestors.at(-1)?.selector ? root.querySelector(ancestors.at(-1).selector) : labelNode.parentElement;
  const controls = findCandidateControls(searchRoot ?? labelNode.parentElement, labelNode, root).slice(0, 40);

  return {
    label,
    found: true,
    labelNode: describeElement(labelNode),
    ancestors,
    controls: controls.map((element) => describeElementWithHitTest(element, root))
  };
}

function findExactText(label, root) {
  return all(root, "label,span,div,p").find((element) => normalizeText(element.textContent) === label && isVisible(element));
}

function findCandidateControls(container, labelNode, root) {
  if (!container) return [];
  return unique(
    all(container, CONTROL_SELECTOR).filter((element) => {
      if (!isVisible(element)) return false;
      if (element === labelNode || element.contains(labelNode)) return false;
      const text = normalizeText(element.textContent);
      const placeholder = element.getAttribute?.("placeholder") ?? "";
      const value = element.value ?? "";
      if (!text && !placeholder && !value && !element.className && element.tagName !== "SVG") return false;
      return true;
    })
  );
}

function findVisiblePopupLikeElements(root) {
  return all(root, "div,ul,ol,[role='listbox'],[role='menu']").filter((element) => {
    if (!isVisible(element)) return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width < 80 || rect.height < 60) return false;
    const text = normalizeText(element.textContent);
    return /3-5年|本科|学历不限|请选择经验要求|请选择最低学历/.test(text);
  }).slice(0, 20);
}

function describeElementWithHitTest(element, root) {
  const description = describeElement(element);
  const rect = element.getBoundingClientRect?.();
  if (!rect) return description;

  const center = pointInRect(rect, 0.5);
  const right = pointInRect(rect, 0.88);
  return {
    ...description,
    hitTest: {
      center: describeElement(root.elementFromPoint?.(center.x, center.y)),
      right: describeElement(root.elementFromPoint?.(right.x, right.y))
    }
  };
}

function pointInRect(rect, xRatio) {
  return {
    x: Math.round(rect.left + rect.width * xRatio),
    y: Math.round(rect.top + rect.height / 2)
  };
}

function describeElement(element) {
  if (!element || element.nodeType !== 1) return null;
  const rect = element.getBoundingClientRect?.();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  return {
    tag: element.tagName.toLowerCase(),
    selector: selectorFor(element),
    id: element.id || "",
    className: String(element.className || ""),
    role: element.getAttribute("role") || "",
    ariaExpanded: element.getAttribute("aria-expanded") || "",
    ariaHaspopup: element.getAttribute("aria-haspopup") || "",
    placeholder: element.getAttribute("placeholder") || "",
    value: element.value || "",
    readonly: Boolean(element.readOnly || element.hasAttribute("readonly")),
    disabled: Boolean(element.disabled),
    text: normalizeText(element.textContent).slice(0, 160),
    rect: rect
      ? {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      : null,
    style: {
      display: style?.display ?? "",
      visibility: style?.visibility ?? "",
      pointerEvents: style?.pointerEvents ?? "",
      cursor: style?.cursor ?? "",
      zIndex: style?.zIndex ?? ""
    }
  };
}

function selectorFor(element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts = [];
  let node = element;
  for (let depth = 0; depth < 4 && node && node.nodeType === 1 && node.tagName !== "BODY"; depth += 1) {
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

function frameInfo(root) {
  const view = root.defaultView;
  return {
    isTop: view ? view.top === view : true,
    referrer: root.referrer ?? ""
  };
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isVisible(element) {
  let node = element;
  while (node && node.nodeType === 1) {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden") return false;
    node = node.parentElement;
  }
  return true;
}

function all(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

function unique(elements) {
  return elements.filter((element, index, list) => list.indexOf(element) === index);
}
