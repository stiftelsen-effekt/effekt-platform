import { describe, it, expect } from "vitest";
import { HttpStatusError } from "../custom_modules/http";
import { loggableRequestError, redactForAlert } from "../custom_modules/requestErrors";

describe("loggableRequestError", () => {
  it("keeps status, body and the request's method and URL", () => {
    const ex = new HttpStatusError(
      401,
      { error: "unauthorized" },
      { method: "POST", url: "https://apitest.vipps.no/accesstoken/get" },
    );
    const logged = loggableRequestError(ex) as Record<string, unknown>;
    expect(logged).not.toBeInstanceOf(Error);
    expect(logged).toEqual(
      expect.objectContaining({
        statusCode: 401,
        method: "POST",
        url: "https://apitest.vipps.no/accesstoken/get",
      }),
    );
    expect(logged.error).toStrictEqual({ error: "unauthorized" });
    expect(Object.keys(logged)).not.toContain("headers");
  });

  it("passes other errors through", () => {
    const ex = new Error("db down");
    expect(loggableRequestError(ex)).toBe(ex);
  });
});

describe("redactForAlert", () => {
  it("reduces HTTP status errors and drops their stack", () => {
    const ex = new HttpStatusError(
      400,
      { message: "bad due date" },
      { method: "POST", url: "https://api.vipps.no/recurring/v3/agreements/agr_1/charges" },
    );
    const reduced = redactForAlert(ex) as Record<string, unknown>;
    expect(reduced).not.toHaveProperty("stack");
    const out = JSON.stringify(reduced);
    expect(out).toContain("bad due date");
    expect(out).toContain("400");
  });

  it("redacts credential-like keys at any depth, case-insensitively", () => {
    const out = JSON.stringify(
      redactForAlert({
        amount: 10000,
        agreementId: "agr_1",
        headers: { Authorization: "Bearer t0k" },
        nested: [{ "ocp-apim-subscription-key": "k3y", Client_Secret: "s3cret", keep: "ok" }],
      }),
    );
    expect(out).not.toContain("t0k");
    expect(out).not.toContain("k3y");
    expect(out).not.toContain("s3cret");
    expect(out).toContain("agr_1");
    expect(out).toContain("10000");
    expect(out).toContain('"keep":"ok"');
  });

  it("keeps the message of plain errors and survives cycles", () => {
    const data: any = { err: new Error("db down") };
    data.self = data;
    const out = JSON.stringify(redactForAlert(data));
    expect(out).toContain("db down");
    expect(out).toContain("[circular]");
  });

  it("keeps the code and message of a fetch network error's cause", () => {
    const cause = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
      headers: { Authorization: "Bearer t0k" },
    });
    const ex = new TypeError("fetch failed", { cause });
    const reduced = redactForAlert({ ex }) as any;
    expect(reduced.ex).toEqual(
      expect.objectContaining({ name: "TypeError", message: "fetch failed" }),
    );
    expect(reduced.ex.cause).toEqual(
      expect.objectContaining({ code: "ECONNRESET", message: "read ECONNRESET" }),
    );
    const out = JSON.stringify(reduced);
    expect(out).not.toContain("t0k");
    expect(out).not.toContain("stack");
  });

  it("keeps an undici error code from a nested cause", () => {
    const inner = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const ex = new TypeError("fetch failed", { cause: inner });
    const out = JSON.stringify(redactForAlert(ex));
    expect(out).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(out).toContain("Connect Timeout Error");
  });
});
