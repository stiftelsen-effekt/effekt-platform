import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import { httpRequest, HttpStatusError } from "../custom_modules/http";
import { loggableRequestError, redactForAlert } from "../custom_modules/requestErrors";

const URL = "https://apitest.vipps.no/recurring/v3/agreements/agr_1";
const SECRET_HEADERS = {
  Authorization: "Bearer t0k",
  "Ocp-Apim-Subscription-Key": "k3y",
  client_secret: "s3cret",
};

describe("httpRequest", () => {
  afterEach(() => sinon.restore());

  it("resolves the response text when not in json mode", async () => {
    const fetchStub = sinon
      .stub(globalThis, "fetch")
      .resolves(new Response('{"status":"ACTIVE"}', { status: 200 }));
    const text = await httpRequest(URL, { method: "GET", headers: SECRET_HEADERS });
    expect(text).to.equal('{"status":"ACTIVE"}');

    const [url, init] = fetchStub.firstCall.args as [string, RequestInit];
    expect(url).to.equal(URL);
    expect(init.method).to.equal("GET");
    expect(init.body).to.equal(undefined);
    expect(init.signal).to.equal(undefined);
    expect(init.headers).to.deep.equal(SECRET_HEADERS);
  });

  it("sends a raw body as is", async () => {
    const fetchStub = sinon.stub(globalThis, "fetch").resolves(new Response(null, { status: 204 }));
    const text = await httpRequest(URL, { method: "PATCH", body: '{"status":"STOPPED"}' });
    expect(text).to.equal("");
    expect(fetchStub.firstCall.args[1]?.body).to.equal('{"status":"STOPPED"}');
  });

  it("sends and parses JSON in json mode, keeping a given content-type", async () => {
    const fetchStub = sinon
      .stub(globalThis, "fetch")
      .resolves(new Response('{"url":"https://vipps"}', { status: 200 }));
    const res = await httpRequest(URL, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      json: { amount: 10000 },
    });
    expect(res).to.deep.equal({ url: "https://vipps" });

    const init = fetchStub.firstCall.args[1] as RequestInit;
    expect(init.body).to.equal('{"amount":10000}');
    expect(init.headers).to.deep.equal({
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
    });
  });

  it("resolves undefined for an empty body (204) in json mode, and text if not JSON", async () => {
    sinon
      .stub(globalThis, "fetch")
      .onFirstCall()
      .resolves(new Response(null, { status: 204 }))
      .onSecondCall()
      .resolves(new Response("OK", { status: 200 }));
    expect(await httpRequest(URL, { method: "POST", json: {} })).to.equal(undefined);
    expect(await httpRequest(URL, { method: "POST", json: {} })).to.equal("OK");
  });

  it("throws HttpStatusError with status and parsed body on non-2xx", async () => {
    sinon.stub(globalThis, "fetch").resolves(new Response('[{"errorCode":61}]', { status: 400 }));
    let caught: unknown;
    try {
      await httpRequest(URL, { method: "GET", headers: SECRET_HEADERS });
    } catch (ex) {
      caught = ex;
    }
    expect(caught).to.be.instanceOf(HttpStatusError);
    const err = caught as HttpStatusError;
    expect(err.statusCode).to.equal(400);
    expect(err.body).to.deep.equal([{ errorCode: 61 }]);
    expect(err.message).to.equal('400 - [{"errorCode":61}]');
    expect(err.request).to.deep.equal({ method: "GET", url: URL });
  });

  it("keeps a non-JSON error body as text, and an empty one as undefined", async () => {
    sinon
      .stub(globalThis, "fetch")
      .onFirstCall()
      .resolves(new Response("Bad gateway", { status: 502 }))
      .onSecondCall()
      .resolves(new Response(null, { status: 404 }));
    const first = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(first.statusCode).to.equal(502);
    expect(first.body).to.equal("Bad gateway");
    const second = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(second.statusCode).to.equal(404);
    expect(second.body).to.equal(undefined);
  });

  it("never carries credential headers into errors or their logs", async () => {
    sinon.stub(globalThis, "fetch").resolves(new Response('{"message":"no"}', { status: 401 }));
    const err = await httpRequest(URL, { method: "POST", headers: SECRET_HEADERS, json: {} }).catch(
      (ex) => ex,
    );
    for (const out of [
      JSON.stringify(err),
      JSON.stringify(loggableRequestError(err)),
      JSON.stringify(redactForAlert(err)),
      JSON.stringify(redactForAlert({ wrapped: err })),
    ]) {
      expect(out).to.not.include("t0k");
      expect(out).to.not.include("k3y");
      expect(out).to.not.include("s3cret");
    }
    expect(JSON.stringify(loggableRequestError(err))).to.include("401");
  });

  it("passes a timeout signal only when asked", async () => {
    const fetchStub = sinon.stub(globalThis, "fetch").resolves(new Response("", { status: 200 }));
    await httpRequest(URL, { method: "GET", timeoutMs: 1000 });
    expect(fetchStub.firstCall.args[1]?.signal).to.be.instanceOf(AbortSignal);
  });

  it("rethrows network errors unchanged", async () => {
    const networkError = new TypeError("fetch failed");
    sinon.stub(globalThis, "fetch").rejects(networkError);
    const caught = await httpRequest(URL, { method: "GET" }).catch((ex) => ex);
    expect(caught).to.equal(networkError);
  });
});
