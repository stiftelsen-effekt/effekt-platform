import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebTrpcClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("the server's client (lib/minside/dal.ts)", () => {
  it("sends queries started together as one batched request with the bearer token", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json([{ result: { data: { id: 1 } } }, { result: { data: [] } }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = createWebTrpcClient({
      flavor: "trpc",
      getToken: async () => "token-123",
      url: "https://api.example.org",
    });

    const [profile, donations] = await Promise.all([
      client.minside.profile.query({ donorId: 1 }),
      client.minside.donations.query({ donorId: 1 }),
    ]);

    expect(profile).toEqual({ id: 1 });
    expect(donations).toEqual([]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(
      /^https:\/\/api\.example\.org\/trpc\/minside\.profile,minside\.donations\?batch=1&input=/,
    );
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token-123");
  });
});
