import { describe, it } from "vitest";
import { expect } from "chai";
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
    expect(logged).to.not.be.instanceOf(Error);
    expect(logged).to.include({
      statusCode: 401,
      method: "POST",
      url: "https://apitest.vipps.no/accesstoken/get",
    });
    expect(logged.error).to.deep.equal({ error: "unauthorized" });
    expect(Object.keys(logged)).to.not.include("headers");
  });

  it("passes other errors through", () => {
    const ex = new Error("db down");
    expect(loggableRequestError(ex)).to.equal(ex);
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
    expect(reduced).to.not.have.property("stack");
    const out = JSON.stringify(reduced);
    expect(out).to.include("bad due date");
    expect(out).to.include("400");
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
    expect(out).to.not.include("t0k");
    expect(out).to.not.include("k3y");
    expect(out).to.not.include("s3cret");
    expect(out).to.include("agr_1");
    expect(out).to.include("10000");
    expect(out).to.include('"keep":"ok"');
  });

  it("keeps the message of plain errors and survives cycles", () => {
    const data: any = { err: new Error("db down") };
    data.self = data;
    const out = JSON.stringify(redactForAlert(data));
    expect(out).to.include("db down");
    expect(out).to.include("[circular]");
  });
});
