import { describe, it, beforeAll, afterAll, beforeEach, expect, vi } from "vitest";
import { DAO } from "../custom_modules/DAO";
import * as fs from "fs";
import * as mail from "../custom_modules/mail";

const config = require("../config");

const vippsRoute = require("../routes/reports/vipps");

let addStub;
let mailStub;
let parsingRulesStub;
let queueStub;

describe("Vipps route handles report correctly", () => {
  beforeAll(() => {
    addStub = vi.spyOn(DAO.donations, "add").mockResolvedValue(10);

    mailStub = vi.spyOn(mail, "sendDonationReceipt").mockReturnValue(undefined as any);

    parsingRulesStub = vi.spyOn(DAO.parsing, "getVippsParsingRules").mockResolvedValue([]);

    queueStub = vi.spyOn(DAO.reviewqueue, "add").mockResolvedValue({ added: 5, existing: 0 });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Adds donations to DB", async () => {
    await runVipps("Vipps April 2019");
    expect(addStub).toHaveBeenCalledTimes(10);
  });

  it("Queues unmatched transactions for review without changing the response", async () => {
    parsingRulesStub.mockResolvedValue([]);
    const json = await runVipps("Vipps April 2019");

    expect(queueStub).toHaveBeenCalledOnce();
    expect(queueStub.mock.calls[0][0]).toBe("vipps");
    const queued = queueStub.mock.calls[0][1];
    const { content } = (json.mock.calls[0] as any[])[0];
    expect(Object.keys(content)).toStrictEqual(["valid", "invalid", "invalidTransactions"]);
    expect(queued).toHaveLength(content.invalidTransactions.length);
    expect(queued[0]).to.include({
      externalId: content.invalidTransactions[0].transaction.transactionID,
      paymentId: 4,
      amount: content.invalidTransactions[0].transaction.amount,
    });
  });

  it("Attempts to send mail when in production", async () => {
    config.env = "production";
    await runVipps("Vipps April 2019");
    config.env = "development";

    expect(mailStub).toHaveBeenCalledTimes(10);
  });

  it("Only sends receipts for donations that were added", async () => {
    addStub.mockRejectedValueOnce(new Error("EXISTING_DONATION | already added"));
    addStub.mockRejectedValueOnce(new Error("NO_KID | KID does not exist"));
    config.env = "production";
    try {
      await runVipps("Vipps April 2019");
    } finally {
      config.env = "development";
      addStub.resetBehavior();
      addStub.mockResolvedValue(10);
    }

    expect(addStub).toHaveBeenCalledTimes(10);
    expect(mailStub).toHaveBeenCalledTimes(8);
    expect(mailStub.alwaysCalledWith(10)).to.be.true;
  });

  it("Waits for receipts and keeps going if one fails", async () => {
    let pending = 0;
    let maxPending = 0;
    mailStub.mockImplementation(async () => {
      pending++;
      maxPending = Math.max(maxPending, pending);
      await new Promise((r) => setTimeout(r, 1));
      pending--;
      throw new Error("mail failed");
    });
    config.env = "production";
    try {
      await runVipps("Vipps April 2019");
    } finally {
      config.env = "development";
      mailStub.resetBehavior();
    }

    expect(mailStub).toHaveBeenCalledTimes(10);
    expect(maxPending).toBe(1);
  });

  it("Adds default donations", async () => {
    parsingRulesStub.mockResolvedValue([
      {
        salesLocation: "Stiftelsen Effekt",
        message: "Vipps",
        resolveKID: 12345678,
      },
    ]);

    await runVipps("Vipps April 2019");

    expect(addStub).toHaveBeenCalledTimes(13);
  });

  it("Adds donations from the new Vipps details settlement CSV", async () => {
    parsingRulesStub.mockResolvedValue([
      {
        salesLocation: "Gi Effektivt.",
        message: null,
        resolveKID: 12345678,
      },
    ]);

    await runVipps("Vipps Details June 2026");

    expect(addStub).toHaveBeenCalledTimes(4);
    expect(addStub.mock.calls[0][0]).toBe(12345678);
    expect(addStub.mock.calls[1][0]).toBe(62354782);
    expect(addStub.mock.calls[2][2]).toBe(30);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });
});

async function runVipps(filename) {
  let res = {
    json: () => {},
  };

  const jsonStub = vi.spyOn(res, "json").mockReturnValue(undefined);

  const query = {
    body: {
      metaOwnerID: 3,
    },
    files: {
      report: {
        data: readReport("vipps", filename),
      },
    },
  };

  await vippsRoute(query, res, (ex) => {
    throw ex;
  });
  return jsonStub;
}

function readReport(type, filename, extension = "CSV") {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-fs-filename.detect-non-literal-fs-filename -- test fixture file names are literals in this spec
  return fs.readFileSync(`src/__test__/data/${type}/${filename}.${extension}`);
}
