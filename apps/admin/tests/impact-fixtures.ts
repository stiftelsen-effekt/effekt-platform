/**
 * Fixtures shaped like the impact.* router outputs, for the interaction specs (with
 * stubAnalysisApi's `extra` and `overrides`). Months follow a fixed "now" of November 2026.
 */

const meta = {
  createdAt: "2026-11-01T12:00:00.000Z",
  createdBy: "impact-api migration",
  updatedAt: null,
  updatedBy: null,
};

const estimate = (
  id: number,
  validFrom: string,
  validTo: string | null,
  centsPerOutput: number,
  monthsApplied: number,
) => ({
  id,
  charityId: 1,
  interventionId: 2,
  validFrom,
  validTo,
  centsPerOutput,
  centsPerOutputLowerBound: 0,
  centsPerOutputUpperBound: null,
  sourceName: id === 71 ? "GiveWell directed grants" : "",
  sourceUrl: id === 71 ? "https://docs.google.com/spreadsheets/d/example" : "",
  comment: "",
  monthsApplied,
  current: validTo === null,
  charityName: "Against Malaria Foundation",
  charityAbbreviation: "AMF",
  interventionName: "Bednets",
  costPerOutputNok: ((centsPerOutput * 10) / 100).toFixed(2),
  ...meta,
});

export const amfEstimates = () => [
  estimate(1, "2020-01-01", "2020-12-01", 518, 12),
  estimate(5, "2021-01-01", "2022-12-01", 487, 24),
  estimate(71, "2023-01-01", null, 585, 47),
];

export const estimatesFixture = () => [
  ...amfEstimates().reverse(),
  {
    ...estimate(23, "2020-01-01", null, 713, 83),
    charityId: 10,
    interventionId: 1,
    charityName: "Malaria Consortium",
    charityAbbreviation: "MC",
    interventionName: "SMC",
  },
];

export const charitiesFixture = () => [
  {
    id: 1,
    name: "Against Malaria Foundation",
    abbreviation: "AMF",
    organizationId: 12,
    organizationName: "Against Malaria Foundation",
    estimates: 3,
    allotments: 1,
    currentEstimate: {
      id: 71,
      validFrom: "2023-01-01",
      centsPerOutput: 585,
      interventionName: "Bednets",
    },
    ...meta,
  },
  {
    id: 10,
    name: "Malaria Consortium",
    abbreviation: "MC",
    organizationId: null,
    organizationName: null,
    estimates: 1,
    allotments: 2,
    currentEstimate: {
      id: 23,
      validFrom: "2020-01-01",
      centsPerOutput: 713,
      interventionName: "SMC",
    },
    ...meta,
  },
];

export const interventionsFixture = () => [
  {
    id: 2,
    shortDescription: "Bednets",
    longDescription: "Long-lasting insecticide-treated nets",
    texts: { no: { shortDescription: "Myggnett", longDescription: "Langtidsvirkende myggnett" } },
    estimates: 3,
    allotments: 1,
    ...meta,
  },
  {
    id: 1,
    shortDescription: "SMC",
    longDescription: "Seasonal malaria chemoprevention",
    texts: {},
    estimates: 1,
    allotments: 2,
    ...meta,
  },
];

export const charityTimelineFixture = () => ({
  charity: { ...charitiesFixture()[0]!, ...meta },
  estimates: amfEstimates(),
  nokRate: { date: "2026-10-30", perUsd: 10 },
  currentMonth: "2026-11-01",
});

export const grantsFixture = () => [
  {
    id: 33,
    fund: "TCF",
    validFrom: "2025-02-01",
    validTo: null,
    legacyId: 33,
    monthsApplied: 22,
    current: true,
    allotments: 2,
    totalCents: 1250000000,
    charities: ["Malaria Consortium", "Against Malaria Foundation"],
    ...meta,
  },
  {
    id: 34,
    fund: "AGF",
    validFrom: "2025-01-01",
    validTo: null,
    legacyId: 1,
    monthsApplied: 23,
    current: true,
    allotments: 1,
    totalCents: 100,
    charities: ["GiveWell All Grants Fund"],
    ...meta,
  },
];

const allotment = (
  id: number,
  charityId: number,
  charityName: string,
  sumInCents: number,
  outputs: number,
  share: number,
) => ({
  id,
  charityId,
  interventionId: charityId === 1 ? 2 : 1,
  sumInCents,
  numberOutputsPurchased: outputs,
  numberOutputsPurchasedLowerBound: 0,
  numberOutputsPurchasedUpperBound: null,
  sourceName: "",
  sourceUrl: "",
  comment: "",
  charityName,
  organizationId: charityId === 1 ? 12 : null,
  charityAbbreviation: charityId === 1 ? "AMF" : "MC",
  interventionName: charityId === 1 ? "Bednets" : "SMC",
  share,
  centsPerOutput: sumInCents / outputs,
  costPerOutputNok: ((sumInCents / outputs) * 0.1).toFixed(2),
});

export const grantFixture = () => ({
  id: 33,
  fund: "TCF",
  validFrom: "2025-02-01",
  validTo: null,
  legacyId: 33,
  monthsApplied: 22,
  current: true,
  totalCents: 1250000000,
  allotments: [
    allotment(48, 10, "Malaria Consortium", 890000000, 925156, 0.712),
    allotment(49, 1, "Against Malaria Foundation", 360000000, 565149, 0.288),
  ],
  nokRate: { date: "2026-10-30", perUsd: 10 },
  previousId: 29,
  nextId: null,
  ...meta,
});

export const exchangeRatesFixture = (overrides: Record<string, unknown> = {}) => ({
  currencies: [
    {
      currency: "NOK",
      latestDate: "2026-10-30",
      perUsd: "10.12345678",
      source: "ECB",
      days: 3500,
      firstDate: "2013-01-02",
    },
  ],
  jobRuns: [
    {
      id: 900,
      at: "2026-10-30T16:00:05.000Z",
      result: { from: "2026-10-23", to: "2026-10-30", days: 6, rows: 180 },
    },
  ],
  latestDate: "2026-10-30",
  daysSinceLatest: 2,
  gaps: [],
  today: "2026-11-01",
  ...overrides,
});

export const impactFixtures = (): Record<string, unknown> => ({
  "impact.estimates.list": estimatesFixture(),
  "impact.estimates.charity": charityTimelineFixture(),
  "impact.charities.list": charitiesFixture(),
  "impact.interventions.list": interventionsFixture(),
  "impact.grants.list": grantsFixture(),
  "impact.grants.get": grantFixture(),
  "impact.exchangeRates": exchangeRatesFixture(),
});
