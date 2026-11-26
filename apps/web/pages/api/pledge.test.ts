import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextApiRequest, NextApiResponse } from "next";
import pledge from "./pledge.page";
import { emptyPledgeForm } from "../../components/main/blocks/PledgeSignup/pledgeRequest";

const form = {
  ...emptyPledgeForm("2026-11-24"),
  employmentStatus: "student",
  email: "test.person@example.org",
  firstName: "Test",
  lastName: "Person",
  acceptedTerms: true,
};
const settings = { clubName: "giv-effektivt" };

const call = async (method: string, body?: unknown) => {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, string> };
  const response = {
    status: (code: number) => {
      res.statusCode = code;
      return response;
    },
    json: (data: unknown) => {
      res.body = data;
      return response;
    },
    setHeader: (name: string, value: string) => {
      res.headers[name] = value;
    },
  } as unknown as NextApiResponse;
  await pledge({ method, body } as NextApiRequest, response);
  return res;
};

describe("POST /api/pledge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("only takes POST", async () => {
    expect((await call("GET")).statusCode).toBe(405);
  });

  it("rejects an invalid form with the fields that are wrong", async () => {
    const res = await call("POST", { form: { ...form, email: "nope" }, settings });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ fields: { email: "email_invalid" } });
  });

  it("rejects a form without a club name", async () => {
    expect((await call("POST", { form, settings: {} })).statusCode).toBe(400);
  });

  it("only logs the request in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const res = await call("POST", { form, settings });
    expect(res).toMatchObject({ statusCode: 200, body: { status: "dry_run" } });
    expect(log.mock.calls[0][1]).toContain('"club_name": "giv-effektivt"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses outside development, since it isn't connected to GWWC yet", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await call("POST", { form, settings })).statusCode).toBe(503);
  });
});
