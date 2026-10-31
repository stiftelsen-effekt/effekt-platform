import { describe, expect, it, vi } from "vitest";
import { providerOf, sendInBatches, type SendBatch } from "./inflation";

const noSleep = () => Promise.resolve();

describe("sendInBatches", () => {
  it("sends the requested number in batches no larger than the maximum", async () => {
    let remaining = 60;
    const sendBatch = vi.fn<SendBatch>(async (size) => {
      remaining -= size;
      return { sent: size, failed: 0, cancelled: 0, remaining };
    });
    const onProgress = vi.fn();

    const result = await sendInBatches({
      requested: 55,
      maxBatch: 25,
      sendBatch,
      onProgress,
      sleep: noSleep,
    });

    expect(sendBatch.mock.calls.map((c) => c[0])).toEqual([25, 25, 5]);
    expect(result).toMatchObject({ sent: 55, remaining: 5, done: true });
    expect(onProgress).toHaveBeenCalledTimes(4);
  });

  it("counts failed and cancelled offers as handled", async () => {
    const sendBatch = vi.fn<SendBatch>(async () => ({
      sent: 3,
      failed: 1,
      cancelled: 1,
      remaining: 10,
    }));
    const result = await sendInBatches({
      requested: 10,
      maxBatch: 5,
      sendBatch,
      onProgress: () => {},
      sleep: noSleep,
    });
    expect(sendBatch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ sent: 6, failed: 2, cancelled: 2 });
  });

  it("stops when a batch makes no progress, nothing is left, or on request", async () => {
    const stuck = vi.fn<SendBatch>(async () => ({
      sent: 0,
      failed: 0,
      cancelled: 0,
      remaining: 4,
    }));
    await sendInBatches({ requested: 10, maxBatch: 5, sendBatch: stuck, onProgress: () => {} });
    expect(stuck).toHaveBeenCalledTimes(1);

    const empty = vi.fn<SendBatch>(async () => ({
      sent: 2,
      failed: 0,
      cancelled: 0,
      remaining: 0,
    }));
    await sendInBatches({ requested: 10, maxBatch: 5, sendBatch: empty, onProgress: () => {} });
    expect(empty).toHaveBeenCalledTimes(1);

    let stop = false;
    const stoppable = vi.fn<SendBatch>(async () => {
      stop = true;
      return { sent: 5, failed: 0, cancelled: 0, remaining: 20 };
    });
    await sendInBatches({
      requested: 20,
      maxBatch: 5,
      sendBatch: stoppable,
      onProgress: () => {},
      shouldStop: () => stop,
      sleep: noSleep,
    });
    expect(stoppable).toHaveBeenCalledTimes(1);
  });

  it("keeps what was sent and reports the error when a call fails", async () => {
    const sendBatch = vi
      .fn<SendBatch>()
      .mockResolvedValueOnce({ sent: 5, failed: 0, cancelled: 0, remaining: 10 })
      .mockRejectedValueOnce(new Error("timeout"));
    const result = await sendInBatches({
      requested: 15,
      maxBatch: 5,
      sendBatch,
      onProgress: () => {},
      sleep: noSleep,
    });
    expect(result.sent).toBe(5);
    expect(result.done).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
  });
});

describe("providerOf", () => {
  it("maps the API's agreement types to the admin's providers", () => {
    expect(providerOf("avtaleGiro")).toBe("avtalegiro");
    expect(providerOf("vipps")).toBe("vipps");
  });
});
