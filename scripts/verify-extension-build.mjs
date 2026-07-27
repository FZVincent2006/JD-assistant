import { readdir, readFile } from "node:fs/promises";

const distUrl = new URL("../dist/", import.meta.url);
const builtScripts = Object.fromEntries(await Promise.all(
  ["content.js", "outlook.js"].map(async (name) => [
    name,
    await readFile(new URL(name, distUrl), "utf8")
  ])
));

for (const [name, content] of Object.entries(builtScripts)) {
  if (/^\s*(?:import|export)\b/m.test(content)) {
    throw new Error(`dist/${name} contains ES module syntax and cannot run as a manifest content script`);
  }
}

const manifest = JSON.parse(await readFile(new URL("manifest.json", distUrl), "utf8"));
const background = await readFile(new URL("background.js", distUrl), "utf8");
const allJavaScriptFiles = await listJavaScriptFiles(distUrl);
const allJavaScript = (await Promise.all(
  allJavaScriptFiles.map((fileUrl) => readFile(fileUrl, "utf8"))
)).join("\n");
const requiredFeishuAppId = "cli_aade4224b8789bef";
if (!allJavaScript.includes(requiredFeishuAppId)) {
  throw new Error(`dist JavaScript is missing the required public Feishu App ID: ${requiredFeishuAppId}`);
}
const permissions = new Set(manifest.permissions ?? []);
for (const forbidden of ["clipboardRead", "clipboardWrite", "debugger"]) {
  if (permissions.has(forbidden)) throw new Error(`dist manifest contains forbidden permission: ${forbidden}`);
}
for (const required of ["alarms", "identity", "storage", "nativeMessaging"]) {
  if (!permissions.has(required)) throw new Error(`dist manifest is missing permission: ${required}`);
}

const approvedFeishuHosts = [
  "https://accounts.feishu.cn/*",
  "https://open.feishu.cn/*"
];
const hostPermissionValues = manifest.host_permissions ?? [];
const hostPermissions = new Set(hostPermissionValues);
for (const required of [...approvedFeishuHosts, "https://partner.outlook.cn/*"]) {
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
if (!contentScripts.some((script) =>
  script.js?.includes("outlook.js")
  && script.matches?.includes("https://partner.outlook.cn/mail/*"))) {
  throw new Error("dist manifest is missing the Outlook monitor content script");
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
  "FEISHU_CLEAR_AUTH",
  "FEISHU_JOB_LINK_PLAN",
  "FEISHU_JOB_LINK_WRITE"
]) {
  if (!background.includes(messageType)) throw new Error(`dist background is missing ${messageType}`);
}
for (const messageType of [
  "OUTLOOK_MONITOR_GET",
  "OUTLOOK_MONITOR_SAVE_CONFIG",
  "OUTLOOK_MONITOR_SET_ENABLED"
]) {
  if (!background.includes(messageType)) throw new Error(`dist background is missing ${messageType}`);
}

if (background.includes("APPLY_HEADING_NUMBERING")) {
  throw new Error("dist background still contains the removed native heading-numbering request");
}
if (builtScripts["content.js"].includes("FEISHU_PREPARE_HEADING_NUMBERING")) {
  throw new Error("dist content still contains the removed Feishu heading preparation route");
}
if (`${background}\n${builtScripts["content.js"]}`.includes("shortcut-rejected")) {
  throw new Error("dist contains the removed synthetic page-shortcut path");
}

for (const fileUrl of allJavaScriptFiles) {
  const content = await readFile(fileUrl, "utf8");
  if (/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]{16,}/.test(content)) {
    throw new Error(`Built JavaScript contains an apparent hardcoded Feishu webhook: ${fileUrl.pathname}`);
  }
}

async function listJavaScriptFiles(directoryUrl) {
  const files = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directoryUrl);
    if (entry.isDirectory()) {
      files.push(...await listJavaScriptFiles(entryUrl));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryUrl);
    }
  }
  return files;
}
