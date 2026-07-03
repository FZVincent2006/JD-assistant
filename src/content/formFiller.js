const FIELD_ORDER = [
  "recruitmentType",
  "title",
  "description",
  "experience",
  "education",
  "salary",
  "keywords",
  "location"
];
const REQUIRED_FIELDS = new Set(["recruitmentType", "title", "description", "location"]);

export async function fillRecruitingForm(data, root = document, options = {}) {
  const platform = options.platform ?? detectPlatform(root);
  const result = platform === "maimai" ? await fillMaimaiForm(data, root, options) : fillBossForm(data, root);

  return { platform, ...result };
}

export function fillBossForm(data, root = document) {
  const filled = [];
  const missing = [];

  const actions = {
    recruitmentType: () => clickByText(data.recruitmentType, root),
    title: () => setControlValue(findTextControl(["职位名称", "岗位名称"], "input", root), data.title),
    description: () => setControlValue(findTextControl(["职位描述", "岗位描述"], "textarea", root), data.description),
    experience: () => setControlValue(findTextControl(["经验", "经验要求"], "input,select", root), data.experience),
    education: () => setControlValue(findTextControl(["学历", "最低学历"], "input,select", root), data.education),
    salary: () => fillSalary(data, root),
    keywords: () => {
      const value = Array.isArray(data.keywords) ? data.keywords.join("、") : data.keywords;
      return setControlValue(findTextControl(["职位关键词", "关键词"], "input,textarea", root), value);
    },
    location: () => setControlValue(findTextControl(["工作地址", "职位地址"], "input", root), data.location)
  };

  for (const field of FIELD_ORDER) {
    if (field !== "salary" && isEmpty(data[field])) {
      if (REQUIRED_FIELDS.has(field)) missing.push(field);
      continue;
    }

    if (field === "salary" && !data.salaryMinK && !data.salaryMaxK) {
      continue;
    }

    if (actions[field]()) {
      filled.push(field);
    } else {
      missing.push(field);
    }
  }

  return { filled, missing };
}

async function fillMaimaiForm(data, root, options = {}) {
  const filled = [];
  const missing = [];
  const actions = {
    title: () => setControlValue(findTextControl(["职位名称"], "input", root), formatMaimaiTitle(data)),
    description: () =>
      setControlValue(findTextControl(["职位描述", "岗位职责", "任职要求"], "textarea", root), data.description),
    experience: () =>
      selectMaimaiValue(["经验学历", "工作经验"], data.experience, root, options, {
        placeholder: "请选择工作经验要求",
        controlIndex: 0,
        preferLabel: true
      }),
    education: () =>
      selectMaimaiValue(["经验学历", "学历"], data.education, root, options, {
        placeholder: "请选择学历要求",
        controlIndex: 1,
        preferLabel: true
      }),
    salary: () => selectMaimaiValue(["薪资范围"], formatSalary(data), root, options),
    industry: () => selectMaimaiIndustry(root, options),
    email: () => setControlValue(findTextControl(["邮箱地址"], "input", root), data.email),
    jobAttribute: () => clickByText("普通职位", root)
  };

  for (const field of [
    "title",
    "description",
    "experience",
    "education",
    "salary",
    "industry",
    "email",
    "jobAttribute"
  ]) {
    if (field !== "salary" && field !== "jobAttribute" && field !== "industry" && isEmpty(valueForField(data, field))) {
      if (["title", "description", "location"].includes(field)) missing.push(field);
      continue;
    }

    if (field === "salary" && !formatSalary(data)) continue;
    if (field === "industry" && shouldWaitForRequirementFields(data, filled)) continue;

    if (await actions[field]()) {
      filled.push(field);
      await delay(options.fieldDelayMs ?? 650);
    } else if (["title", "description", "location"].includes(field)) {
      missing.push(field);
    }
  }

  return { filled, missing };
}

function shouldWaitForRequirementFields(data, filled) {
  return Boolean(
    (data.experience && !filled.includes("experience")) ||
      (data.education && !filled.includes("education"))
  );
}

function detectPlatform(root) {
  const pageText = root.body?.textContent ?? "";
  if (pageText.includes("公开招") || pageText.includes("私密招") || pageText.includes("我是猎头")) {
    return "maimai";
  }

  return "boss";
}

function isEmpty(value) {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

function fillSalary(data, root) {
  if (!data.salaryMinK && !data.salaryMaxK) return false;

  const minControl = findTextControl(["薪资范围", "最低月薪", "最低薪资"], "input,select", root);
  const maxControl = findTextControl(["最高月薪", "最高薪资"], "input,select", root);
  const minDone = data.salaryMinK ? setControlValue(minControl, data.salaryMinK) : true;
  const maxDone = data.salaryMaxK ? setControlValue(maxControl, data.salaryMaxK) : true;

  return Boolean(minDone && maxDone);
}

async function selectMaimaiValue(labels, value, root, options = {}, selectOptions = {}) {
  if (!value) return false;
  const placeholder = typeof selectOptions === "string" ? selectOptions : selectOptions.placeholder;
  const controlIndex = typeof selectOptions === "object" ? selectOptions.controlIndex ?? 0 : 0;
  const preferLabel = typeof selectOptions === "object" ? Boolean(selectOptions.preferLabel) : false;
  const labelTarget = findClickableNearLabels(labels, root, controlIndex, placeholder);
  const textTarget = placeholder ? findClickableByText(placeholder, root) : null;
  const targets = uniqueElements(preferLabel ? [labelTarget, textTarget] : [textTarget, labelTarget]);

  for (const target of targets) {
    const clickAttempts = placeholder ? getClickAttempts(target, root) : [target];
    for (const clickTarget of clickAttempts) {
      clickTarget.dataset.recruitingAssistantValue = value;
      clickElement(clickTarget);

      let option = await waitForPopupOption(value, root, options);
      if (!option) {
        pressOpenKey(clickTarget);
        option = await waitForPopupOption(value, root, options);
      }
      if (option && option !== clickTarget) {
        clickElement(option);
        await delay(options.settleMs ?? 120);
        return true;
      }
    }
  }

  return !placeholder;
}

function getClickAttempts(target, root) {
  const attempts = [target];
  const targetText = getClickableText(target);
  let node = target.parentElement;

  while (node && node !== root.body) {
    if (isVisible(node) && isLikelySameFieldBox(node, targetText)) {
      attempts.push(node);
    }
    if (normalizeLabel(getText(node)).includes("经验学历")) break;
    node = node.parentElement;
  }

  return uniqueElements(attempts);
}

function getClickableText(element) {
  const directText = element.getAttribute?.("placeholder") || element.value || getText(element);
  const nestedInput = element.querySelector?.("input[placeholder],input[value]");
  const nestedText = nestedInput?.getAttribute("placeholder") || nestedInput?.value || "";
  return `${directText} ${nestedText}`.trim();
}

function isLikelySameFieldBox(element, targetText) {
  if (element.tagName !== "DIV") return false;
  const text = `${getText(element)} ${getClickableText(element)}`.trim();
  if (!targetText || !text.includes(targetText)) return false;
  if (normalizeLabel(text).includes("经验学历")) return false;
  return true;
}

function pressOpenKey(target) {
  const targetWindow = target.ownerDocument.defaultView ?? window;
  const KeyboardEventConstructor = targetWindow.KeyboardEvent ?? KeyboardEvent;
  const eventOptions = { bubbles: true, cancelable: true, key: "ArrowDown", code: "ArrowDown" };
  target.dispatchEvent(new KeyboardEventConstructor("keydown", eventOptions));
  target.dispatchEvent(new KeyboardEventConstructor("keyup", eventOptions));
}

function uniqueElements(elements) {
  return elements.filter((element, index, list) => element && list.indexOf(element) === index);
}

async function selectMaimaiIndustry(root, options = {}) {
  const target = findClickableNearLabels(["行业要求"], root);
  if (!target) return false;
  target.dataset.recruitingAssistantValue = "不限行业";
  clickElement(target);

  const unrestrictedOptions = await waitForPopupOptions("不限行业", root, options);
  const rightOption = unrestrictedOptions.at(-1);
  if (!rightOption) return false;
  clickElement(rightOption);
  await delay(options.settleMs ?? 120);
  const confirm = await waitForPopupOption("确定", root, options);
  if (confirm) clickElement(confirm);
  await delay(options.settleMs ?? 120);
  return true;
}

function findPopupOption(value, root) {
  return findPopupOptions(value, root)[0] ?? null;
}

async function waitForPopupOption(value, root, options = {}) {
  return (await waitForPopupOptions(value, root, options))[0] ?? null;
}

async function waitForPopupOptions(value, root, options = {}) {
  const timeoutMs = options.optionTimeoutMs ?? 1800;
  const pollMs = options.optionPollMs ?? 50;
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const optionsFound = findPopupOptions(value, root);
    if (optionsFound.length > 0) return optionsFound;
    await delay(pollMs);
  }

  return [];
}

function findPopupOptions(value, root) {
  const wanted = normalizeOptionText(value);
  const candidates = all(
    root,
    "[role='option'],[role='menuitem'],li,button,span,div,[class*='option'],[class*='item'],[class*='dropdown'] div"
  );

  return candidates.filter((element) => {
    if (!isVisible(element)) return false;
    const text = normalizeOptionText(getText(element));
    if (text !== wanted) return false;
    return !all(element, "*").some((child) => normalizeOptionText(getText(child)) === wanted);
  });
}

function normalizeOptionText(value) {
  return String(value)
    .replace(/[‐‑‒–—~到至]/g, "-")
    .replace(/\s+/g, "")
    .replace(/k/g, "K")
    .trim();
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findClickableNearLabels(labels, root, controlIndex = 0, preferredText = "") {
  for (const label of labels) {
    const labelNode = all(root, "label,span,div,p").find((node) => normalizeLabel(getText(node)) === label);
    if (!labelNode) continue;
    const container = findFieldContainer(labelNode, root, controlIndex);
    const exactClickable = preferredText ? findExactClickableInContainer(container, preferredText, root) : null;
    if (exactClickable) return exactClickable;

    const clickables = container ? findClickableControls(container, labelNode, root) : [];
    const clickable = clickables[controlIndex] ?? clickables[0];
    if (clickable && clickable !== labelNode) return toClickableSurface(clickable, root);

    const next = findNextControl(labelNode, "[role='button'],button,input,textarea,[contenteditable='true']");
    if (next) return toClickableSurface(next, root);
  }

  return null;
}

function findExactClickableInContainer(container, text, root) {
  if (!container) return null;
  const match = all(container, "[role='button'],button,div,span,input,[contenteditable='true']").find((element) => {
    if (!isVisible(element)) return false;
    return getText(element) === text || element.getAttribute("placeholder") === text || element.value === text;
  });

  return match ? toClickableSurface(match, root) : null;
}

function findClickableByText(text, root) {
  const match = all(root, "[role='button'],button,div,span,input,[contenteditable='true']").find((element) => {
    if (!isVisible(element)) return false;
    return getText(element) === text || element.getAttribute("placeholder") === text || element.value === text;
  });

  return match ? toClickableSurface(match, root) : null;
}

function findFieldContainer(labelNode, root, controlIndex) {
  let node = labelNode.parentElement;
  for (let i = 0; i < 5 && node && node !== root.body; i += 1) {
    if (findClickableControls(node, labelNode, root).length > controlIndex) return node;
    node = node.parentElement;
  }

  return labelNode.closest("div") ?? labelNode.parentElement;
}

function findClickableControls(container, labelNode, root) {
  const selector = [
    "[role='button']",
    "button",
    "input",
    "textarea",
    "[contenteditable='true']",
    "[aria-haspopup]",
    "[aria-expanded]",
    "[class*='select']",
    "[class*='Select']",
    "[class*='picker']",
    "[class*='Picker']"
  ].join(",");

  const surfaces = all(container, selector).filter((element) => {
    if (element === labelNode || element.contains(labelNode)) return false;
    if (!isVisible(element)) return false;
    return element.tagName !== "SPAN";
  }).map((element) => toClickableSurface(element, root));

  return uniqueElements(surfaces).filter((element, _index, list) => {
    return !list.some((other) => other !== element && other.contains(element));
  });
}

function toClickableSurface(element, root) {
  if (isReadonlySelectInput(element)) {
    const visualBox = findVisualInputBox(element, root);
    if (visualBox) return visualBox;
  }

  const closest = element.closest?.(SELECT_SHELL_SELECTOR);
  if (closest && closest !== element.ownerDocument.body) return closest;
  if (isNativeClickable(element)) return element;

  let node = element.parentElement;
  while (node && node !== root.body) {
    if (node.tagName === "DIV" && getText(node).includes(getText(element))) return node;
    node = node.parentElement;
  }

  return element;
}

const SELECT_SHELL_SELECTOR = [
    "[role='button']",
    "button",
    "[aria-haspopup]",
    "[aria-expanded]",
    "[class*='select']",
    "[class*='Select']",
    "[class*='picker']",
    "[class*='Picker']"
  ].join(",");

function isReadonlySelectInput(element) {
  return (
    element.tagName === "INPUT" &&
    (element.readOnly || element.hasAttribute("readonly") || /^请选择/.test(element.placeholder ?? "")) &&
    Boolean(element.placeholder || element.value)
  );
}

function findVisualInputBox(element, root) {
  let node = element.parentElement;
  while (node && node !== root.body) {
    const inputs = all(node, "input");
    if (node.tagName === "DIV" && inputs.length === 1 && inputs[0] === element) return node;
    node = node.parentElement;
  }

  return null;
}

function isNativeClickable(element) {
  return (
    ["BUTTON", "INPUT", "TEXTAREA"].includes(element.tagName) ||
    element.getAttribute("role") === "button" ||
    element.getAttribute("contenteditable") === "true" ||
    element.hasAttribute("aria-haspopup") ||
    element.hasAttribute("aria-expanded")
  );
}

function formatSalary(data) {
  if (!data.salaryMinK && !data.salaryMaxK) return "";
  if (data.salaryMinK && data.salaryMaxK) return `${data.salaryMinK}-${data.salaryMaxK}K`;
  return `${data.salaryMinK || data.salaryMaxK}K`;
}

function formatMaimaiTitle(data) {
  if (!data.title) return "";
  if (/^【真格被投-[^】]+】/.test(data.title)) return data.title;
  if (!data.companyName) return data.title;
  return `【真格被投-${data.companyName}】${data.title}`;
}

function valueForField(data, field) {
  if (field === "keywords") return data.keywords;
  if (field === "jobCategory") return data.jobType;
  if (field === "highlights") return data.highlights;
  return data[field];
}

function normalizeLabel(text) {
  return text.replace(/^\*\s*/, "").trim();
}

function clickByText(text, root) {
  const target = all(root, "button,[role='button'],label,span,div").find((element) => {
    return getText(element) === text && isActionLike(element);
  });

  if (!target) return false;
  clickElement(target);
  return true;
}

function clickElement(target) {
  target.dataset.bossAssistantSelected = "true";
  target.dataset.recruitingAssistantSelected = "true";
  target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  focusWithoutScrolling(target);
  const rect = target.getBoundingClientRect?.();
  const clientX = rect ? rect.left + rect.width / 2 : 0;
  const clientY = rect ? rect.top + rect.height / 2 : 0;
  const eventTarget = findEventTargetAtPoint(target, clientX, clientY);
  eventTarget.dataset.bossAssistantSelected = "true";
  eventTarget.dataset.recruitingAssistantSelected = "true";
  const targetWindow = target.ownerDocument.defaultView ?? window;
  const eventOptions = { bubbles: true, cancelable: true, clientX, clientY };
  const PointerEventConstructor = targetWindow.PointerEvent;
  const MouseEventConstructor = targetWindow.MouseEvent ?? MouseEvent;

  if (PointerEventConstructor) {
    eventTarget.dispatchEvent(new PointerEventConstructor("pointerdown", eventOptions));
  }
  eventTarget.dispatchEvent(new MouseEventConstructor("mousedown", eventOptions));
  if (PointerEventConstructor) {
    eventTarget.dispatchEvent(new PointerEventConstructor("pointerup", eventOptions));
  }
  eventTarget.dispatchEvent(new MouseEventConstructor("mouseup", eventOptions));
  eventTarget.dispatchEvent(new MouseEventConstructor("click", eventOptions));
}

function findEventTargetAtPoint(target, clientX, clientY) {
  const hit = target.ownerDocument.elementFromPoint?.(clientX, clientY);
  if (hit && (hit === target || target.contains(hit))) return hit;
  return target;
}

function focusWithoutScrolling(target) {
  try {
    target.focus?.({ preventScroll: true });
  } catch {
    target.focus?.();
  }
}

function findTextControl(labels, selector, root) {
  const controls = all(root, selector);
  const byPlaceholder = controls.find((control) => {
    const placeholder = control.getAttribute("placeholder") ?? "";
    return labels.some((label) => placeholder.includes(label));
  });
  if (byPlaceholder) return byPlaceholder;

  for (const label of labels) {
    const labelNode = all(root, "label,span,div,p").find((node) => normalizeLabel(getText(node)) === label);
    if (!labelNode) continue;

    const nearby = findNextControl(labelNode, selector);
    if (nearby) return nearby;
  }

  return null;
}

function findNextControl(labelNode, selector) {
  let node = labelNode;
  for (let i = 0; i < 12 && node; i += 1) {
    const nested = node.querySelector?.(selector);
    if (nested) return nested;

    node = node.nextElementSibling;
    if (node?.matches?.(selector)) return node;
    const siblingControl = node?.querySelector?.(selector);
    if (siblingControl) return siblingControl;
  }

  return labelNode.parentElement?.querySelector?.(selector) ?? null;
}

function setControlValue(control, value) {
  if (!control) return false;
  const prototype = Object.getPrototypeOf(control);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(control, value);
  } else {
    control.value = value;
  }

  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function all(root, selector) {
  return Array.from(root.querySelectorAll(selector));
}

function getText(element) {
  return element.textContent.replace(/\s+/g, " ").trim();
}

function isActionLike(element) {
  return ["BUTTON", "LABEL"].includes(element.tagName) || element.getAttribute("role") === "button";
}
