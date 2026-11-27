import { describe, it, afterEach, expect, vi } from "vitest";
const vipps = require("../custom_modules/vipps");

describe("toOre", () => {
  it("converts kroner to whole øre, from numbers and decimal strings", () => {
    expect(vipps.toOre(100)).toBe(10000);
    expect(vipps.toOre("250")).toBe(25000);
    expect(vipps.toOre(0.29)).toBe(29);
    expect(vipps.toOre("99.99")).toBe(9999);
    expect(vipps.toOre(1.005)).toBeTypeOf("number");
    expect(vipps.toOre(1.005)).toSatisfy(Number.isInteger);
  });

  it("rejects amounts that are not positive numbers", () => {
    for (const bad of [0, -5, NaN, "abc", ""]) {
      expect(() => vipps.toOre(bad), String(bad)).toThrow("Invalid amount");
    }
  });
});

describe("resilientPoll", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes the check's answer through", async () => {
    const poll = vipps.resilientPoll("x", async () => true);
    expect(await poll(1)).toBe(true);
  });

  it("keeps polling after an error, and stops once the time is up", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    const poll = vipps.resilientPoll("x", async () => {
      throw new Error("ECONNRESET");
    });
    expect(await poll(1)).toBe(false);
    expect(await poll(100000)).toBe(true);
  });
});

describe("captureOrder", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rethrows a network error instead of failing on its missing body", async () => {
    vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(vipps, "fetchToken").mockResolvedValue({ type: "Bearer", token: "t" });
    const networkError = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

    let caught: unknown;
    try {
      await vipps.captureOrder("123-1", { amount: 10000 });
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBe(networkError);
  });

  it("treats Vipps error code 61 (already captured) as captured", async () => {
    vi.spyOn(vipps, "fetchToken").mockResolvedValue({ type: "Bearer", token: "t" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ errorCode: 61 }]), { status: 400 }),
    );
    expect(await vipps.captureOrder("123-1", { amount: 10000 })).toBe(true);
  });

  it("treats 423 (locked) as captured", async () => {
    vi.spyOn(vipps, "fetchToken").mockResolvedValue({ type: "Bearer", token: "t" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 423 }));
    expect(await vipps.captureOrder("123-1", { amount: 10000 })).toBe(true);
  });

  it("logs a failed capture without credential headers and rethrows it", async () => {
    const errorStub = vi.spyOn(console, "error").mockReturnValue(undefined);
    vi.spyOn(vipps, "fetchToken").mockResolvedValue({ type: "Bearer", token: "t0k" });
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify([{ errorCode: 99 }]), { status: 400 }));

    let caught: any;
    try {
      await vipps.captureOrder("123-1", { amount: 10000 });
    } catch (ex) {
      caught = ex;
    }
    expect(caught.statusCode).toBe(400);
    expect(caught.body).toStrictEqual([{ errorCode: 99 }]);

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/ecomm\/v2\/payments\/123-1\/capture$/);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t0k");
    expect(JSON.parse(init.body as string).transaction.amount).toBe(10000);

    const logged = JSON.stringify(errorStub.mock.calls[0]);
    expect(logged).not.toContain("t0k");
    expect(logged).toContain("400");
  });
});
