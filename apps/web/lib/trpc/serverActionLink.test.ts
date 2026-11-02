import { describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { createServerActionTrpcClient } from "./serverActionLink";

describe("serverActionLink", () => {
  it("sends a mutation to the action and returns its data", async () => {
    const run = vi.fn(async () => ({ ok: true as const, data: { id: 7 } }));
    const trpc = createServerActionTrpcClient(run);
    const input = { donorId: 1, name: "Ny enhet", ssn: "15868510045" };
    await expect(trpc.minside.createTaxUnit.mutate(input)).resolves.toEqual({ id: 7 });
    expect(run).toHaveBeenCalledWith("minside.createTaxUnit", input);
  });

  it("turns a failed action into a TRPCClientError with the API's code and status", async () => {
    const run = vi.fn(async () => ({
      ok: false as const,
      error: { code: "FORBIDDEN", httpStatus: 403, message: "Not the logged-in donor" },
    }));
    const error = await createServerActionTrpcClient(run)
      .minside.cancelAvtaleGiroAgreement.mutate({ donorId: 2, KID: "123" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as TRPCClientError<never>).data).toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
      path: "minside.cancelAvtaleGiroAgreement",
    });
  });

  it("sends no queries (the pages render their data on the server)", async () => {
    const run = vi.fn();
    const error = await createServerActionTrpcClient(run)
      .minside.taxUnits.query({ donorId: 1 })
      .catch((e: unknown) => e);
    expect((error as TRPCClientError<never>).data).toMatchObject({ code: "NOT_IMPLEMENTED" });
    expect(run).not.toHaveBeenCalled();
  });
});
