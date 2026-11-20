import { describe, it, beforeAll, expect } from "vitest";
import { isoDate, toDay } from "../../prisma/devdata/calendar";
import { config } from "../../prisma/devdata/config";
import { generate, type Dataset, type Row } from "../../prisma/devdata/generate";
import { AvtaleGiroChargeStatus } from "../custom_modules/avtalegiro/charges";

/** AvtaleGiro charges in the local dev data (prisma/devdata/generate.ts › avtaleGiroChargeRun) */
describe("dev data: AvtaleGiro charges", { timeout: 30000 }, function () {
  const start = toDay("2021-10-01");
  const end = toDay("2026-10-27");
  let data: Dataset;
  let charges: Row[];

  // Generating the dataset takes about a second alone, but several times that when the whole suite
  // runs in parallel: give the hook the same budget as the tests (the default hook timeout is 5 s)
  beforeAll(() => {
    data = generate({ seed: "effekt-dev", start, end, anchor: end, scale: 1 });
    charges = data.Avtalegiro_agreement_charges;
  }, 30000);

  const withStatus = (status: string) => charges.filter((c) => c.status === status);
  const today = isoDate(end);

  it("has claims in the statuses the jobs produce, only for recent months", () => {
    const statuses = new Set(charges.map((c) => c.status));
    for (const status of statuses) {
      expect(Object.values(AvtaleGiroChargeStatus)).toContain(status);
    }
    expect(withStatus("COMPLETED").length).toBeGreaterThan(1000);
    expect(withStatus("SUPERSEDED").length).toBeGreaterThan(0);
    expect(withStatus("DELETED").length).toBeGreaterThan(0);
    // Upcoming claims, already sent, and a few past ones that were never paid
    expect(withStatus("CLAIMED").some((c) => String(c.due_date) > today)).toBe(true);
    expect(withStatus("CLAIMED").some((c) => String(c.due_date) < today)).toBe(true);

    const first = charges.map((c) => String(c.created)).sort()[0];
    const initialEnd = start + Math.round(config.years * 365.25);
    expect(first >= isoDate(initialEnd - config.avtaleGiro.chargeHistoryDays)).toBe(true);
  });

  it("links each completed claim to the AvtaleGiro payment for its KID", () => {
    const donations = new Map(data.Donations.map((d) => [d.ID, d]));
    for (const charge of withStatus("COMPLETED")) {
      const donation = donations.get(charge.donationID as number)!;
      expect(donation, `donation ${charge.donationID}`).not.toBeNullable();
      expect(donation.KID_fordeling).toBe(charge.KID);
      expect(Number(donation.sum_confirmed) * 100).toBe(charge.amount);
      expect(String(donation.timestamp_confirmed).slice(0, 10) >= String(charge.due_date)).toBe(
        true,
      );
    }
    const linked = charges.filter((c) => c.donationID !== null).map((c) => c.donationID);
    expect(new Set(linked).size).toBe(linked.length);
  });

  it("has one live claim per agreement and due date; a superseded one has its retry", () => {
    const live = new Map<string, Row>();
    for (const charge of charges.filter((c) => c.status !== "SUPERSEDED")) {
      const key = `${charge.agreementID}:${charge.due_date}`;
      expect(live.has(key), key).toBe(false);
      live.set(key, charge);
    }
    for (const superseded of withStatus("SUPERSEDED")) {
      const retry = live.get(`${superseded.agreementID}:${superseded.due_date}`)!;
      expect(retry).not.toBeNullable();
      expect(retry.shipmentID as number).toBeGreaterThan(superseded.shipmentID as number);
    }
  });

  it("deletes claims of agreements cancelled before the due date", () => {
    const agreements = new Map(data.Avtalegiro_agreements.map((a) => [a.ID, a]));
    for (const charge of charges.filter((c) => String(c.status).startsWith("DELETE"))) {
      const agreement = agreements.get(charge.agreementID)!;
      expect(agreement.cancelled).toBeTypeOf("string");
      expect(String(agreement.cancelled) < String(charge.due_date)).toBe(true);
      expect(charge.deletion_shipmentID).toBeTypeOf("number");
      expect(charge.donationID).toBeNull();
    }
  });
});
