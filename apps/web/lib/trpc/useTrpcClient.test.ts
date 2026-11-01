import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainLocaleContext } from "../../context/MainLocaleContext";
import { TrpcClientContext, useTrpcClient } from "./useTrpcClient";
import { TrpcClient, createWebTrpcClient } from "./client";

const fetchToken = (async () => "token-123") as any;

afterEach(() => vi.unstubAllGlobals());

/** Renders consumers and returns the clients they got */
const clientsSeenBy = (consumers: number, shared: TrpcClient | null) => {
  const seen: TrpcClient[] = [];
  const Consumer = () => {
    seen.push(useTrpcClient(fetchToken));
    return null;
  };
  renderToStaticMarkup(
    h(
      MainLocaleContext.Provider,
      { value: "no" },
      h(
        TrpcClientContext.Provider,
        { value: shared },
        ...Array.from({ length: consumers }, (_, i) => h(Consumer, { key: i })),
      ),
    ),
  );
  return seen;
};

describe("useTrpcClient", () => {
  it("gives every query on a Min Side page the layout's client", () => {
    const shared = createWebTrpcClient({ flavor: "trpc", getToken: async () => "t" });
    const seen = clientsSeenBy(3, shared);
    expect(seen).toHaveLength(3);
    seen.forEach((client) => expect(client).toBe(shared));
  });

  it("creates a client of its own outside the Min Side layout", () => {
    const [client] = clientsSeenBy(1, null);
    expect(client).toBeDefined();
    expect(typeof client.minside.profile.query).toBe("function");
  });
});

describe("the shared client", () => {
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
