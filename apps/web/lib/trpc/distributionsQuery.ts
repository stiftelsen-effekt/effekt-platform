import type { ApiFlavor } from "./client";

/** The KID list part of the SWR key of the query for all of a donor's distributions */
export const ALL_KIDS = "*";

/** SWR key of the distributions for these KIDs */
export const distributionsKey = (donorId: number, kids: string[]) =>
  ["minside.distributions", donorId, kids.join(",")] as const;

/** SWR key of all of the donor's distributions */
export const allDistributionsKey = (donorId: number) =>
  ["minside.distributions", donorId, ALL_KIDS] as const;

/**
 * The SWR key of Min Side's distributions query (null: don't fetch yet). Our API returns all of
 * the donor's distributions when `kids` is left out, so they are fetched right away, in the page's
 * first batch (the page looks them up by KID). The Danish backend only answers for the KIDs it is
 * given, so there the query waits until the page knows them (`condition`), as before.
 */
export const distributionsQuery = (
  flavor: ApiFlavor,
  donorId: number | null,
  condition: boolean,
  kids: string[],
) => {
  if (donorId === null) return null;
  if (flavor === "trpc") return allDistributionsKey(donorId);
  return condition ? distributionsKey(donorId, kids) : null;
};

/** The minside.distributions input for a key from distributionsQuery */
export const distributionsInput = (donorId: number, kidList: string) =>
  kidList === ALL_KIDS ? { donorId } : { donorId, kids: kidList ? kidList.split(",") : [] };
