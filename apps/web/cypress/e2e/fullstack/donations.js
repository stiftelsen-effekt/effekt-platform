/**
 * Full-stack Min Side donations page: the donations, the yearly aggregates and the distributions
 * come from the real API (tRPC minside.donations, minside.donationsAggregated and
 * minside.distributions) and database, for the e2e donor written by apps/api/prisma/e2e/seed.mjs.
 */
import {
  DONOR_ID,
  KIDS,
  TAX_UNITS,
  AGF,
  HKI,
  NI,
  AMF,
  IMPACT,
} from "../../../../../apps/api/prisma/e2e/data.mjs";
import { trpcData, trpcQueryInput, trpcUrl } from "../../support/trpc";

// The seeded donations (apps/api/prisma/e2e/seed.mjs): 7 donations, 5 200 kr in total, 2022–2025
const TOTAL = 5200;
const YEARS = [2022, 2023, 2024, 2025];

describe("Donations page (full stack)", () => {
  beforeEach(() => {
    cy.task("resetE2EData");
    cy.loginFullstack(DONOR_ID);

    cy.intercept("GET", trpcUrl("minside.donations")).as("donations");
    cy.intercept("GET", trpcUrl("minside.donationsAggregated")).as("aggregated");
    cy.intercept("GET", trpcUrl("minside.distributions")).as("distributions");
    // The impact comes with minside.donations: nothing may call the legacy impact API
    cy.intercept("https://impact.gieffektivt.no/**", () => {
      throw new Error("Min Side called the legacy impact API");
    }).as("legacyImpact");

    cy.visit("/min-side/");
    cy.wait(["@donations", "@aggregated", "@distributions"], { timeout: 30000 });
  });

  it("gets the donor's donations, aggregates and distributions from the API", () => {
    cy.get("@donations").then((interception) => {
      const donations = trpcData(interception, "minside.donations");
      expect(donations).to.have.length(7);
      expect(donations.find((d) => d.id === 900006)).to.deep.include({
        KID: KIDS.bank,
        donorId: DONOR_ID,
        sum: "2500.00",
        timestamp: "2025-09-01T12:00:00.000Z",
        taxUnitId: TAX_UNITS.spouse.id,
      });
    });

    cy.get("@aggregated").then((interception) => {
      const rows = trpcData(interception, "minside.donationsAggregated");
      const total = rows.reduce((sum, row) => sum + parseFloat(row.value), 0);
      expect(Math.round(total)).to.equal(TOTAL);
      expect([...new Set(rows.map((row) => row.year))].sort()).to.deep.equal(YEARS);
    });

    cy.get("@distributions").then((interception) => {
      const distributions = trpcData(interception, "minside.distributions");
      // All of the donor's distributions, fetched without a KID list in the page's first batch:
      // those of the donations (bank, Vipps (custom) and AvtaleGiro) among them, and only the donor's
      expect(trpcQueryInput(interception, "minside.distributions")).to.deep.equal({
        donorId: DONOR_ID,
      });
      const kids = distributions.map((d) => d.kid);
      expect(kids).to.include.members([KIDS.bank, KIDS.vippsCustom, KIDS.avtalegiro]);
      expect(Object.values(KIDS)).to.include.members(kids);
      distributions.forEach((d) => expect(d.donorId).to.equal(DONOR_ID));
      const custom = distributions.find((d) => d.kid === KIDS.vippsCustom);
      expect(custom.taxUnitId).to.equal(TAX_UNITS.main.id);
      expect(custom.causeAreas).to.have.length(1);
      expect(
        custom.causeAreas[0].organizations.map((o) => [o.id, parseFloat(o.percentageShare)]),
      ).to.have.deep.members([
        [AGF, 30],
        [HKI, 15],
        [NI, 25],
        [AMF, 30],
      ]);
    });
  });

  it("shows the total and a list per year", () => {
    cy.get("[data-cy=aggregated-donation-totals]").should("contain.text", "5 200 kr");
    for (const year of YEARS) {
      cy.get("[data-cy=year-menu]").should("contain.text", year);
      cy.get("[data-cy=generic-list-header]").should("contain.text", year);
    }
  });

  it("lists a donation with its sum and KID", () => {
    cy.get("[data-cy=generic-list-table]")
      .contains("tbody", KIDS.bank)
      .should("contain.text", "2 500 kr");
  });

  it("shows the stored distribution when a donation is expanded", () => {
    cy.get("[data-cy=generic-list-table]")
      .contains("tbody", KIDS.vippsCustom)
      .as("donation")
      .find("[data-cy=generic-list-row-expand]")
      .first()
      .click();

    cy.get("@donation").find("[data-cy=donation-impact-list]").should("exist");
    cy.get("@donation").should("not.contain.text", "Ingen distribusjon funnet");
  });

  it("shows only that year's donations when a year is picked", () => {
    cy.get("[data-cy=year-menu]").find("ul").contains("li", "2024").click();
    cy.get("[data-cy=generic-list-header]").should("have.length", 1).and("contain.text", "2024");
    // 2024 has the Vipps and AvtaleGiro donations; the bank transfers are from other years
    cy.get("[data-cy=generic-list-table]")
      .should("contain.text", KIDS.vippsCustom)
      .and("contain.text", KIDS.avtalegiro)
      .and("not.contain.text", KIDS.bank);
  });

  describe("impact", () => {
    /** Sums the entries with a count per output, named as Min Side's table names them */
    const outputs = (donations) => {
      const sums = {};
      for (const donation of donations) {
        for (const e of donation.impact ?? []) {
          if (e.count === null) continue;
          const unit = /[A-Z]-/.test(e.unit) ? e.unit : e.unit.toLowerCase();
          sums[unit] = (sums[unit] ?? 0) + e.count;
        }
      }
      return sums;
    };

    it("gets every donation's impact with the donations, computed on the server", () => {
      cy.get("@donations").then((interception) => {
        const donations = trpcData(interception, "minside.donations");
        expect(donations.every((d) => Array.isArray(d.impact))).to.equal(true);

        const sums = outputs(donations);
        expect(Object.keys(sums).sort()).to.deep.equal(Object.keys(IMPACT.total).sort());
        for (const [unit, expected] of Object.entries(IMPACT.total)) {
          expect(sums[unit], unit).to.be.closeTo(expected, 0.001);
        }
        expect(outputs(donations.filter((d) => d.timestamp.startsWith("2025")))).to.satisfy(
          (year) =>
            Object.entries(IMPACT.year2025).every(([u, v]) => Math.abs(year[u] - v) < 0.001),
        );

        // The All Grants Fund and operations have no estimate, only their kroner
        const entries = donations.flatMap((d) => d.impact);
        const agf = entries.filter((e) => e.organizationId === AGF);
        expect(agf.length).to.be.greaterThan(0);
        expect(agf.every((e) => e.count === null)).to.equal(true);
        const operations = entries.filter((e) => e.count === null && /drift/i.test(e.organization));
        expect(operations.reduce((s, e) => s + e.amount, 0)).to.be.closeTo(IMPACT.operations, 0.01);
        // Every krone of every donation is in its impact entries
        for (const d of donations) {
          expect(d.impact.reduce((s, e) => s + e.amount, 0)).to.be.closeTo(parseFloat(d.sum), 0.01);
        }
      });
    });

    it("shows the totals per output in the impact table", () => {
      cy.get("[data-cy=donation-aggregate-impact-distribution-row]").as("rows");
      cy.get("@rows").should("have.length", 4);
      // Sorted by name; rounded to whole outputs, or the first decimal that isn't 0
      const expected = [
        ["3", "A-vitamintilskudd"],
        ["10", "malariabehandlinger"],
        ["34", "myggnett"],
        ["0,4", "vaksinasjoner"],
      ];
      expected.forEach(([number, unit], i) => {
        cy.get("@rows").eq(i).find("strong").should("have.text", number);
        cy.get("@rows").eq(i).should("contain.text", unit);
      });
    });

    it("shows a year's totals", () => {
      cy.get("[data-cy=year-menu]").find("ul").contains("li", "2025").click();
      cy.get("[data-cy=donation-aggregate-impact-distribution-row]").as("rows");
      cy.get("@rows").should("have.length", 2);
      cy.get("@rows").eq(0).find("strong").should("have.text", "7");
      cy.get("@rows").eq(0).should("contain.text", "malariabehandlinger");
      cy.get("@rows").eq(1).find("strong").should("have.text", "22");
      cy.get("@rows").eq(1).should("contain.text", "myggnett");
    });

    it("shows a donation's own impact when it is expanded", () => {
      cy.get("[data-cy=generic-list-table]")
        .contains("tbody", "2 500 kr")
        .as("donation")
        .find("[data-cy=generic-list-row-expand]")
        .first()
        .click();
      // 1 000 kr to AMF directly: 17,09 nets, shown as 17
      cy.get("@donation")
        .find("[data-cy=donation-impact-list-item-output]")
        .should("contain.text", String(Math.round(IMPACT.donation900006Amf)));
      cy.get("@donation").should("contain.text", "Myggnett");
    });
  });
});
