import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkcePair,
  parseOAuthCallback
} from "../src/lib/feishuPkce.js";

describe("Feishu PKCE helpers", () => {
  it("creates an RFC 7636 S256 verifier and challenge", async () => {
    const pair = await createPkcePair(globalThis.crypto);

    expect(pair.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pair.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pair.challenge).not.toBe(pair.verifier);
  });

  it("builds an authorization URL without a client secret", async () => {
    const pair = await createPkcePair(globalThis.crypto);
    const url = new URL(buildAuthorizeUrl({
      appId: "cli_public",
      redirectUri: "https://extension.chromiumapp.org/feishu",
      scopes: ["wiki:wiki:readonly", "docx:document:readonly"],
      state: "state-1",
      challenge: pair.challenge
    }));

    expect(url.origin).toBe("https://accounts.feishu.cn");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("wiki:wiki:readonly docx:document:readonly");
    expect(url.searchParams.has("client_secret")).toBe(false);
  });

  it("creates a URL-safe OAuth state", () => {
    expect(createOAuthState(globalThis.crypto)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns the code only when state matches", () => {
    expect(parseOAuthCallback("https://extension.chromiumapp.org/feishu?code=abc&state=s1", "s1"))
      .toEqual({ code: "abc" });
    expect(() => parseOAuthCallback("https://extension.chromiumapp.org/feishu?code=abc&state=wrong", "s1"))
      .toThrow("OAuth state mismatch");
  });

  it("reports a denied authorization without exposing callback data", () => {
    expect(() => parseOAuthCallback("https://extension.chromiumapp.org/feishu?error=access_denied&state=s1", "s1"))
      .toThrow("Feishu authorization was cancelled");
  });
});
