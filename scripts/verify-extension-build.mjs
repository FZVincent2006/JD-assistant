import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../dist/content.js", import.meta.url), "utf8");
if (/^\s*(?:import|export)\b/m.test(content)) {
  throw new Error("dist/content.js contains ES module syntax and cannot run as a manifest content script");
}

const manifest = JSON.parse(await readFile(new URL("../dist/manifest.json", import.meta.url), "utf8"));
const background = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");
const permissions = new Set(manifest.permissions ?? []);
for (const forbidden of ["clipboardRead", "clipboardWrite", "debugger"]) {
  if (permissions.has(forbidden)) throw new Error(`dist manifest contains forbidden permission: ${forbidden}`);
}
for (const required of ["identity", "storage", "nativeMessaging"]) {
  if (!permissions.has(required)) throw new Error(`dist manifest is missing permission: ${required}`);
}

const approvedFeishuHosts = [
  "https://accounts.feishu.cn/*",
  "https://open.feishu.cn/*"
];
const hostPermissionValues = manifest.host_permissions ?? [];
const hostPermissions = new Set(hostPermissionValues);
for (const required of approvedFeishuHosts) {
  if (!hostPermissions.has(required)) throw new Error(`dist manifest is missing host permission: ${required}`);
}
const feishuHosts = hostPermissionValues.filter((host) => host.includes("feishu.cn"));
if (feishuHosts.length !== approvedFeishuHosts.length
  || feishuHosts.some((host) => !approvedFeishuHosts.includes(host))) {
  throw new Error("dist manifest contains an unapproved or duplicate Feishu host permission");
}

const recruitingMatches = [
  "https://*.zhipin.com/*",
  "https://*.kanzhun.com/*",
  "https://maimai.cn/*",
  "https://*.maimai.cn/*",
  "https://maimai.com/*",
  "https://*.maimai.com/*"
];
const contentScripts = manifest.content_scripts ?? [];
const contentMatches = new Set(contentScripts.flatMap((script) => script.matches ?? []));
for (const required of recruitingMatches) {
  if (!hostPermissions.has(required) || !contentMatches.has(required)) {
    throw new Error(`dist manifest lost a recruiting page match: ${required}`);
  }
}
const feishuEntries = contentScripts.filter((script) =>
  (script.matches ?? []).some((match) => match.includes("feishu.cn")));
if (feishuEntries.length !== 0) {
  throw new Error("dist manifest must not inject a content script into Feishu pages");
}

for (const messageType of [
  "FEISHU_AUTH_STATUS",
  "FEISHU_AUTHORIZE",
  "FEISHU_INSPECT",
  "FEISHU_PLAN",
  "FEISHU_WRITE",
  "FEISHU_CLEAR_AUTH"
]) {
  if (!background.includes(messageType)) throw new Error(`dist background is missing ${messageType}`);
}

if (background.includes("APPLY_HEADING_NUMBERING")) {
  throw new Error("dist background still contains the removed native heading-numbering request");
}
if (content.includes("FEISHU_PREPARE_HEADING_NUMBERING")) {
  throw new Error("dist content still contains the removed Feishu heading preparation route");
}
if (`${background}\n${content}`.includes("shortcut-rejected")) {
  throw new Error("dist contains the removed synthetic page-shortcut path");
}
