import { readdir, readFile } from "node:fs/promises";

const distUrl = new URL("../dist/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", distUrl), "utf8"));
const content = await readFile(new URL("content.js", distUrl), "utf8");
if (/^\s*(?:import|export)\b/m.test(content)) {
  throw new Error("dist/content.js contains ES module syntax and cannot run as a manifest content script");
}

const expectedPermissions = ["activeTab", "scripting", "sidePanel", "tabs", "webNavigation"];
if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`dist manifest permissions differ from the approved set: ${manifest.permissions}`);
}
if (manifest.background) throw new Error("dist manifest unexpectedly contains a background worker");

const recruitingMatches = [
  "https://*.zhipin.com/*",
  "https://*.kanzhun.com/*",
  "https://maimai.cn/*",
  "https://*.maimai.cn/*",
  "https://maimai.com/*",
  "https://*.maimai.com/*"
];
const contentScripts = manifest.content_scripts ?? [];
if (contentScripts.length !== 1 || contentScripts[0].js?.join() !== "content.js") {
  throw new Error("dist manifest must contain only the recruiting content script");
}
const matches = new Set(contentScripts[0].matches ?? []);
const hosts = new Set(manifest.host_permissions ?? []);
for (const required of recruitingMatches) {
  if (!matches.has(required) || !hosts.has(required)) {
    throw new Error(`dist manifest lost a recruiting page match: ${required}`);
  }
}
if ([...matches, ...hosts].some((value) => /feishu|outlook/i.test(value))) {
  throw new Error("dist manifest contains a removed platform host");
}

for (const obsolete of ["FEISHU_", "OUTLOOK_", "accounts.feishu.cn", "partner.outlook.cn"]) {
  if (content.includes(obsolete)) throw new Error(`dist content bundle contains removed feature marker: ${obsolete}`);
}

const files = await listFiles(distUrl);
if (files.includes("background.js") || files.includes("outlook.js")) {
  throw new Error("dist contains a removed background or Outlook bundle");
}

async function listFiles(directoryUrl, prefix = "") {
  const results = [];
  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) results.push(...await listFiles(new URL(`${entry.name}/`, directoryUrl), `${relative}/`));
    else if (entry.isFile()) results.push(relative);
  }
  return results;
}
