import { describe, it, beforeEach, afterEach } from "vitest";
import { expect } from "chai";
import sinon from "sinon";
import { enqueueTidbytDonationConfirmed } from "../tidbyt/tidbytWorkerEnqueue";

const config = require("../config");

const payload = { donationId: 7, amount: 500, timestamp: "2026-11-01T12:00:00.000Z" };

describe("enqueueTidbytDonationConfirmed (global fetch)", () => {
  let fetchStub: sinon.SinonStub;

  beforeEach(() => {
    sinon.stub(config, "tidbyt_push_enabled").value(true);
    sinon.stub(config, "tidbyt_worker_url").value("https://tidbyt.example/");
    sinon.stub(config, "tidbyt_worker_auth_token").value("t0ken");
    fetchStub = sinon.stub(globalThis, "fetch");
  });
  afterEach(() => sinon.restore());

  it("posts the payload as JSON with the bearer token", async () => {
    fetchStub.resolves(new Response(null, { status: 202 }));

    enqueueTidbytDonationConfirmed(payload);

    expect(fetchStub.calledOnce).to.equal(true);
    const [url, init] = fetchStub.firstCall.args;
    expect(url).to.equal("https://tidbyt.example/donations/confirmed");
    expect(init.method).to.equal("POST");
    expect(init.headers).to.deep.equal({
      "Content-Type": "application/json",
      Authorization: "Bearer t0ken",
    });
    expect(JSON.parse(init.body)).to.deep.equal(payload);
    expect(init.signal).to.be.instanceOf(AbortSignal);
  });

  it("swallows network errors and aborts (fire-and-forget)", async () => {
    let signal: AbortSignal | undefined;
    fetchStub.callsFake((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.reject(new TypeError("fetch failed"));
    });

    expect(() => enqueueTidbytDonationConfirmed(payload)).to.not.throw();
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await new Promise((r) => setTimeout(r, 10));
    expect(signal?.aborted).to.equal(false);
  });

  it("does nothing when the push is disabled", () => {
    sinon.stub(config, "tidbyt_push_enabled").value(false);
    enqueueTidbytDonationConfirmed(payload);
    expect(fetchStub.called).to.equal(false);
  });
});
