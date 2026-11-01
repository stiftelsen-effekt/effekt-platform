import { describe, expect, it } from "vitest";
import { Donation, DonationImpactEntry, META_OWNER } from "../../../../models";
import {
  aggregateDanishImpact,
  aggregateImpact,
  DK_OPERATIONS_KEY,
  formatOutputType,
  GIVEWELL_ALL_GRANTS_FUND_KEY,
} from "./_util";

/**
 * Min Side's impact table from the donations' `impact` entries (minside.donations computes them
 * on the server; docs/impact-api-migration.md)
 */

const TEMPLATES = {
  org_grant_template_string: "{{org}} via fond",
  org_direct_template_string: "{{org}} direkte",
};

const donation = (id: number, impact?: DonationImpactEntry[]): Donation => ({
  id,
  KID: "000001",
  donor: "Test Donor",
  donorId: 1,
  email: "test@example.com",
  sum: "1000.00",
  transactionCost: "0",
  timestamp: "2024-05-15T12:00:00.000Z",
  paymentMethod: "Bank",
  taxUnitId: null,
  metaOwnerId: META_OWNER.EFFEKT,
  ...(impact ? { impact } : {}),
});

const amfDirect: DonationImpactEntry = {
  recipient: "Against Malaria Foundation",
  unit: "Myggnett",
  organization: "Against Malaria Foundation",
  organizationId: 1,
  description: "Myggnett impregnert med insektmiddel",
  viaFund: false,
  amount: 500,
  count: 82.5,
};
const amfViaFund: DonationImpactEntry = {
  ...amfDirect,
  organization: "GiveWell Top Charities Fund",
  organizationId: 12,
  viaFund: true,
  amount: 200,
  count: 31,
};
const vitaminA: DonationImpactEntry = {
  recipient: "Helen Keller International",
  unit: "A-vitamintilskudd",
  organization: "GiveWell Top Charities Fund",
  organizationId: 12,
  viaFund: true,
  amount: 100,
  count: 50,
};
const noEstimate = (organization: string, organizationId: number, amount: number) => ({
  recipient: organization,
  unit: null,
  organization,
  organizationId,
  amount,
  count: null,
});

describe("aggregateImpact", () => {
  it("sums outputs per output type and splits kroner into via-fund and direct constituents", () => {
    const impact = aggregateImpact(
      [donation(1, [amfDirect, amfViaFund, vitaminA]), donation(2, [amfDirect])],
      TEMPLATES,
    );
    expect(impact).toEqual({
      myggnett: {
        outputs: 82.5 + 31 + 82.5,
        constituents: {
          "Against Malaria Foundation direkte": 1000,
          "Against Malaria Foundation via fond": 200,
        },
      },
      "A-vitamintilskudd": {
        outputs: 50,
        constituents: { "Helen Keller International via fond": 100 },
      },
    });
  });

  it("shows operations and the All Grants Fund as kroner, and leaves out other parts without an estimate", () => {
    const impact = aggregateImpact(
      [
        donation(1, [
          noEstimate("Drift av Gi Effektivt", 11, 50),
          noEstimate("GiveWell All Grants Fund", 15, 300),
          noEstimate("Family Empowerment Media", 20, 70),
        ]),
        donation(2, [noEstimate("Drift av Gi Effektivt", 11, 25)]),
      ],
      TEMPLATES,
    );
    expect(impact).toEqual({
      "Drift av Gi Effektivt": { outputs: 75, constituents: {} },
      [GIVEWELL_ALL_GRANTS_FUND_KEY]: { outputs: 300, constituents: {} },
    });
  });

  it("adds nothing for donations without impact (no figures yet) and is empty without donations", () => {
    expect(aggregateImpact([donation(1)], TEMPLATES)).toEqual({});
    expect(aggregateImpact([], TEMPLATES)).toEqual({});
  });
});

describe("aggregateDanishImpact", () => {
  it("sums the Danish backend's entries per unit, with operations as kroner", () => {
    const impact = aggregateDanishImpact([
      donation(1, [
        {
          recipient: "Against Malaria Foundation",
          unit: "myggenet",
          organization: "Myggenet mod malaria",
          amount: 300,
          count: 70,
        },
        { recipient: "Giv Effektivt", unit: null, organization: null, amount: 30, count: null },
      ]),
    ]);
    expect(impact).toEqual({
      myggenet: { outputs: 70, constituents: { "Against Malaria Foundation": 300 } },
      [DK_OPERATIONS_KEY]: { outputs: 30, constituents: {} },
    });
  });
});

describe("formatOutputType", () => {
  it("lower-cases output names except vitamin names", () => {
    expect(formatOutputType("Myggnett")).toBe("myggnett");
    expect(formatOutputType("A-vitamintilskudd")).toBe("A-vitamintilskudd");
  });
});
