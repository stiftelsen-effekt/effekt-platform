import { TRPCClientError } from "@trpc/client";
import type { TrpcClient } from "../../lib/trpc/client";
import { Donor, TaxUnit } from "../../models";

/** Saves the donor's name and newsletter choice (tRPC minside.updateProfile). Null on failure. */
export const saveDonor = async (data: Donor, donorId: number, trpc: TrpcClient) => {
  try {
    await trpc.minside.updateProfile.mutate({
      donorId,
      name: data.name ?? "",
      newsletter: data.newsletter,
    });
    return data;
  } catch {
    return null;
  }
};

/** The error message to show for a failed tax unit change, or false if there is none */
const errorMessage = (e: unknown): string | false => {
  console.error(e);
  return e instanceof TRPCClientError && e.message ? e.message : false;
};

/**
 * Creates a tax unit (tRPC minside.createTaxUnit; the page refreshes with the new list). Returns the new
 * unit, the error message, or false.
 */
export const createTaxUnit = async (
  data: Partial<TaxUnit>,
  donorId: number,
  trpc: TrpcClient,
): Promise<TaxUnit | string | false> => {
  try {
    const taxUnit = await trpc.minside.createTaxUnit.mutate({
      donorId,
      name: data.name ?? "",
      ssn: data.ssn ?? "",
    });
    // Without the sums, which the revalidated list has
    return taxUnit as TaxUnit;
  } catch (e) {
    return errorMessage(e);
  }
};

/** Changes a tax unit's name and ssn (tRPC minside.updateTaxUnit); like createTaxUnit */
export const updateTaxUnit = async (
  data: TaxUnit,
  donorId: number,
  trpc: TrpcClient,
): Promise<TaxUnit | string | false> => {
  try {
    const taxUnit = await trpc.minside.updateTaxUnit.mutate({
      donorId,
      taxUnitId: data.id,
      name: data.name,
      ssn: data.ssn,
    });
    return { ...data, ...taxUnit } as TaxUnit;
  } catch (e) {
    return errorMessage(e);
  }
};

/**
 * Archives a tax unit (tRPC minside.deleteTaxUnit), optionally moving this year's donations to
 * `transferUnit`. Returns true, the error message, or false.
 */
export const deleteTaxUnit = async (
  data: { unit: TaxUnit; transferUnit: TaxUnit | null },
  donorId: number,
  trpc: TrpcClient,
): Promise<string | boolean> => {
  try {
    await trpc.minside.deleteTaxUnit.mutate({
      donorId,
      taxUnitId: data.unit.id,
      transferTaxUnitId: data.transferUnit?.id ?? null,
    });
    return true;
  } catch (e) {
    return errorMessage(e);
  }
};
