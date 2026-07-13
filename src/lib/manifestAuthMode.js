export function applyFeishuAuthMode(manifest, authMode = "pkce") {
  if (authMode !== "pkce" && authMode !== "native") {
    throw new Error(`Unsupported Feishu auth mode: ${authMode}`);
  }
  const next = structuredClone(manifest);
  const permissions = [...new Set(next.permissions ?? [])].filter((value) => value !== "nativeMessaging");
  if (authMode === "native") permissions.push("nativeMessaging");
  next.permissions = permissions;
  return next;
}
