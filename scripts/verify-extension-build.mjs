import { readFile } from "node:fs/promises";

const content = await readFile(new URL("../dist/content.js", import.meta.url), "utf8");
if (/^\s*import\b/m.test(content)) {
  throw new Error("dist/content.js contains an ES module import and cannot run as a manifest content script");
}

const manifest = JSON.parse(await readFile(new URL("../dist/manifest.json", import.meta.url), "utf8"));
const background = await readFile(new URL("../dist/background.js", import.meta.url), "utf8");
const permissions = new Set(manifest.permissions ?? []);
for (const forbidden of ["clipboardRead", "clipboardWrite", "debugger"]) {
  if (permissions.has(forbidden)) throw new Error(`dist manifest contains forbidden permission: ${forbidden}`);
}
for (const required of ["identity", "storage"]) {
  if (!permissions.has(required)) throw new Error(`dist manifest is missing permission: ${required}`);
}

const hostPermissions = new Set(manifest.host_permissions ?? []);
for (const required of ["https://accounts.feishu.cn/*", "https://open.feishu.cn/*"]) {
  if (!hostPermissions.has(required)) throw new Error(`dist manifest is missing host permission: ${required}`);
}
if (hostPermissions.has("https://zhenfund.feishu.cn/*")) {
  throw new Error("dist manifest must not request Feishu page access");
}

const recruitingMatches = [
  "https://*.zhipin.com/*",
  "https://*.kanzhun.com/*",
  "https://maimai.cn/*",
  "https://*.maimai.cn/*",
  "https://maimai.com/*",
  "https://*.maimai.com/*"
];
const contentMatches = new Set((manifest.content_scripts ?? []).flatMap((script) => script.matches ?? []));
for (const required of recruitingMatches) {
  if (!hostPermissions.has(required) || !contentMatches.has(required)) {
    throw new Error(`dist manifest lost a recruiting page match: ${required}`);
  }
}
if ([...contentMatches].some((match) => match.includes("feishu.cn"))) {
  throw new Error("dist manifest must not inject a content script into Feishu");
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
