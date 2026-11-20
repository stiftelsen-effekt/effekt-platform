import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import type { MockInstance } from "vitest";
import { enqueueTidbytDonationConfirmed } from "../tidbyt/tidbytWorkerEnqueue";

const config = require("../config");

const payload = { donationId: 7, amount: 500, timestamp: "2026-11-01T12:00:00.000Z" };

describe("enqueueTidbytDonationConfirmed (global fetch)", () => {
  let fetchStub: MockInstance;

  beforeEach(() => {
    vi.spyOn(config, "tidbyt_push_enabled", "get").mockReturnValue(true);
    vi.spyOn(config, "tidbyt_worker_url", "get").mockReturnValue("https://tidbyt.example/");
    vi.spyOn(config, "tidbyt_worker_auth_token", "get").mockReturnValue("t0ken");
    fetchStub = vi.spyOn(globalThis, "fetch").mockReturnValue(undefined as any);
  });
  afterEach(() => vi.restoreAllMocks());

  it("posts the payload as JSON with the bearer token", async () => {
    fetchStub.mockResolvedValue(new Response(null, { status: 202 }));

    enqueueTidbytDonationConfirmed(payload);

    expect(fetchStub).toHaveBeenCalledOnce();
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe("https://tidbyt.example/donations/confirmed");
    expect(init.method).toBe("POST");
    expect(init.headers).toStrictEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer t0ken",
    });
    expect(JSON.parse(init.body)).toStrictEqual(payload);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("swallows network errors and aborts (fire-and-forget)", async () => {
    let signal: AbortSignal | undefined;
    fetchStub.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.reject(new TypeError("fetch failed"));
    });

    expect(() => enqueueTidbytDonationConfirmed(payload)).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 10));
    expect(signal?.aborted).toBe(false);
  });

  it("does nothing when the push is disabled", () => {
    vi.spyOn(config, "tidbyt_push_enabled", "get").mockReturnValue(false);
    enqueueTidbytDonationConfirmed(payload);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
