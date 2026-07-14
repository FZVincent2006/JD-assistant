import { readFile } from "node:fs/promises";

const REPOSITORY = "FZVincent2006/JD-assistant";
const EXTENSION_ID = "mlhjjkclfiocgafhjdhoicghiabkeggg";

export function validateReleaseChannel(input) {
  if (!input || input.schemaVersion !== 1) {
    throw new Error("Unsupported release channel schema");
  }

  const value = { ...input };
  if (value.repository !== REPOSITORY) throw new Error("Unexpected release repository");
  if (!/^v[0-9A-Za-z][0-9A-Za-z._-]*$/.test(value.tag ?? "")) {
    throw new Error("Invalid release tag");
  }
  if (!/^JD-assistant-macOS-[0-9]{8}\.zip$/.test(value.assetName ?? "")) {
    throw new Error("Invalid release asset name");
  }

  const expectedUrl = `https://github.com/${REPOSITORY}/releases/download/${value.tag}/${value.assetName}`;
  if (value.assetUrl !== expectedUrl) throw new Error("Unexpected release asset URL");
  if (!/^[0-9a-f]{64}$/.test(value.sha256 ?? "")) throw new Error("Invalid asset SHA-256");
  if (value.extensionId !== EXTENSION_ID) throw new Error("Unexpected extension ID");
  if (!/^\d+\.\d+\.\d+$/.test(value.extensionVersion ?? "")) {
    throw new Error("Invalid extension version");
  }
  if (!/^[0-9a-f]{40}$/.test(value.buildCommit ?? "")) {
    throw new Error("Invalid build commit");
  }
  if (!/^\d+\.\d+$/.test(value.minimumMacOS ?? "")) {
    throw new Error("Invalid macOS floor");
  }

  return Object.freeze(value);
}

export async function loadReleaseChannel(pathname) {
  return validateReleaseChannel(JSON.parse(await readFile(pathname, "utf8")));
}
