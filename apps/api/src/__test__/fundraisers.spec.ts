import { describe, it, afterEach, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { DAO } from "../custom_modules/DAO";
import { fundraisersRouter } from "../routes/fundraisers";

describe("GET /fundraisers/dashboard/:secret", () => {
  afterEach(() => vi.restoreAllMocks());

  it("HTML-escapes donor-supplied names and messages", async () => {
    vi.spyOn(DAO.fundraisers, "getFundraiserTransactionsBySecret").mockResolvedValue([
      {
        id: 1,
        message: "<img src=x onerror=alert(document.domain)>",
        name: "<b>x</b>",
        amount: 100,
        date: new Date("2026-01-01"),
        donorName: "Donor",
        donorEmail: "donor@example.test",
      },
    ] as any);

    const app = express();
    app.use("/fundraisers", fundraisersRouter);
    const res = await request(app).get("/fundraisers/dashboard/secret").expect(200);

    expect(res.text).not.toContain("<img");
    expect(res.text).not.toContain("<b>x</b>");
    expect(res.text).toContain("&lt;img src=x onerror=alert(document.domain)&gt;");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});
