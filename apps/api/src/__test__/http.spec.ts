import { describe, it, afterEach, expect, vi } from "vitest";
import { httpRequest, HttpStatusError } from "../custom_modules/http";
import { loggableRequestError, redactForAlert } from "../custom_modules/requestErrors";

const URL = "https://apitest.vipps.no/recurring/v3/agreements/agr_1";
const SECRET_HEADERS = {
  Authorization: "Bearer t0k",
  "Ocp-Apim-Subscription-Key": "k3y",
  client_secret: "s3cret",
};

describe("httpRequest", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves the response text when not in json mode", async () => {
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"status":"ACTIVE"}', { status: 200 }));
    const text = await httpRequest(URL, { method: "GET", headers: SECRET_HEADERS });
    expect(text).toBe('{"status":"ACTIVE"}');

    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL);
    expect(init.method).toBe("GET");
    expect(init.body).toBe(undefined);
    expect(init.signal).toBe(undefined);
    expect(init.headers).toStrictEqual(SECRET_HEADERS);
  });

  it("sends a raw body as is", async () => {
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    const text = await httpRequest(URL, { method: "PATCH", body: '{"status":"STOPPED"}' });
    expect(text).toBe("");
    expect(fetchStub.mock.calls[0][1]?.body).toBe('{"status":"STOPPED"}');
  });

  it("sends and parses JSON in json mode, keeping a given content-type", async () => {
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response('{"url":"https://vipps"}', { status: 200 }));
    const res = await httpRequest(URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      json: { amount: 10000 },
    });
    expect(res).toStrictEqual({ url: "https://vipps" });

    const init = fetchStub.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe('{"amount":10000}');
    expect(init.headers).toStrictEqual({
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
    });
  });

  it("resolves undefined for an empty body (204) in json mode, and text if not JSON", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockReturnValue(undefined as any)
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("OK", { status: 200 }));
    expect(await httpRequest(URL, { method: "POST", json: {} })).toBe(undefined);
    expect(await httpRequest(URL, { method: "POST", json: {} })).toBe("OK");
  });

  it("throws HttpStatusError with status and parsed body on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('[{"errorCode":61}]', { status: 400 }),
    );
    let caught: unknown;
    try {
      await httpRequest(URL, { method: "GET", headers: SECRET_HEADERS });
    } catch (ex) {
      caught = ex;
    }
    expect(caught).toBeInstanceOf(HttpStatusError);
    const err = caught as HttpStatusError;
    expect(err.statusCode).toBe(400);
    expect(err.body).toStrictEqual([{ errorCode: 61 }]);
    expect(err.message).toBe('400 - [{"errorCode":61}]');
    expect(err.request).toStrictEqual({ method: "GET", url: URL });
  });

  it("keeps a non-JSON error body as text, and an empty one as undefined", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockReturnValue(undefined as any)
      .mockResolvedValueOnce(new Response("Bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    const first = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(first.statusCode).toBe(502);
    expect(first.body).toBe("Bad gateway");
    const second = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(second.statusCode).toBe(404);
    expect(second.body).toBe(undefined);
  });

  it("never carries credential headers into errors or their logs", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"message":"no"}', { status: 401 }),
    );
    const err = await httpRequest(URL, { method: "POST", headers: SECRET_HEADERS, json: {} }).catch(
      (ex) => ex,
    );
    for (const out of [
      JSON.stringify(err),
      JSON.stringify(loggableRequestError(err)),
      JSON.stringify(redactForAlert(err)),
      JSON.stringify(redactForAlert({ wrapped: err })),
    ]) {
      expect(out).not.toContain("t0k");
      expect(out).not.toContain("k3y");
      expect(out).not.toContain("s3cret");
    }
    expect(JSON.stringify(loggableRequestError(err))).toContain("401");
  });

  it("passes a timeout signal only when asked", async () => {
    const fetchStub = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));
    await httpRequest(URL, { method: "GET", timeoutMs: 1000 });
    expect(fetchStub.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("rethrows network errors unchanged", async () => {
    const networkError = new TypeError("fetch failed");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);
    const caught = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(caught).toBe(networkError);
  });
});
