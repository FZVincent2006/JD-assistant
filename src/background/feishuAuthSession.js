const SESSION_KEY = "feishuAuthSession";
const EXPIRY_SAFETY_MS = 60_000;

export class FeishuAuthError extends Error {
  constructor(message, { status = 0, code = 0, logId = "", stage = "authorization" } = {}) {
    super(message);
    this.name = "FeishuAuthError";
    Object.assign(this, { status, code, logId, stage });
  }
}

export function createFeishuAuthSession({ chromeApi, now = Date.now }) {
  const session = chromeApi.storage.session;

  async function readValidSession() {
    const stored = (await session.get(SESSION_KEY))[SESSION_KEY];
    if (!stored?.accessToken || !Number.isFinite(stored.expiresAt)) return { state: "missing" };
    if (stored.expiresAt - now() <= EXPIRY_SAFETY_MS) {
      await session.remove(SESSION_KEY);
      return { state: "expired" };
    }
    return { state: "valid", value: stored };
  }

  return {
    async status() {
      const current = await readValidSession();
      if (current.state === "expired") return { status: "expired" };
      if (current.state !== "valid") return { status: "unauthorized" };
      return {
        status: "authorized",
        expiresAt: current.value.expiresAt,
        grantedScopes: [...(current.value.grantedScopes ?? [])]
      };
    },

    async store({ accessToken, expiresIn, scope }) {
      if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new FeishuAuthError("Feishu token response is incomplete");
      }
      const expiresAt = now() + expiresIn * 1000;
      const grantedScopes = String(scope ?? "").split(/\s+/).filter(Boolean);
      await session.set({
        [SESSION_KEY]: { accessToken, expiresAt, grantedScopes }
      });
      return { status: "authorized", expiresAt, grantedScopes };
    },

    async getAccessToken() {
      const current = await readValidSession();
      if (current.state !== "valid") {
        throw new FeishuAuthError("Feishu authorization required", {
          stage: "authorization-required"
        });
      }
      return current.value.accessToken;
    },

    async clear() {
      await session.remove(SESSION_KEY);
      return { status: "unauthorized" };
    }
  };
}
