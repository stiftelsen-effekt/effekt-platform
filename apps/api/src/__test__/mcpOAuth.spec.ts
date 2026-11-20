import { describe, it, expect } from "vitest";
import { isAllowedRedirectUri, pkceS256, verifyPkceS256 } from "../custom_modules/mcp/oauthCrypto";

describe("MCP OAuth helpers", function () {
  it("allows Claude hosted and loopback redirect URIs", function () {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.ai/ccr-token-vault-oauth-done")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:3118/callback")).toBe(true);
  });

  it("rejects non-Claude redirect URIs", function () {
    expect(isAllowedRedirectUri("https://evil.example/callback")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai.evil.example/callback")).toBe(false);
    expect(isAllowedRedirectUri("http://claude.ai/callback")).toBe(false);
  });

  it("verifies PKCE S256", function () {
    const verifier = "abcdefghijklmnopqrstuvwxyz0123456789abcdef";
    const challenge = pkceS256(verifier);
    expect(verifyPkceS256(verifier, challenge)).toBe(true);
    expect(verifyPkceS256("wrong-verifier-wrong-verifier-wrong", challenge)).toBe(false);
  });
});
