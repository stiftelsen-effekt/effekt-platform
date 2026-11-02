#!/usr/bin/env node
// A local stand-in for the Danish backend (giveffektivt/donation-platform), for Danish Min Side in
// `pnpm minside:local dk`. It answers the REST routes the website's restLink maps
// (apps/web/lib/trpc/restLink.ts) with synthetic data shaped like the real responses: numeric
// columns as numbers, COUNT(*) as a string, donor id 0, UUID KIDs. No real donor data.
//
//   node scripts/e2e/dk-backend-stub.mjs            port E2E_DK_API_PORT (5151)
//
// Like the real backend it ignores the donor id in the path (it finds the donor by the token's
// email claim) and refuses /donors/* without a bearer token. The token isn't verified: the mock
// issuer's tokens are checked by our own API, and this is a stub.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const port = Number(process.env.E2E_DK_API_PORT ?? 5151);
const causeAreas = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../apps/web/cypress/fixtures/dk/cause_areas.json", import.meta.url)),
    "utf8",
  ),
);
const organizations = causeAreas.flatMap((area) => area.organizations);
const orgName = (id) => organizations.find((o) => o.id === id)?.name ?? `Organisation ${id}`;

const kid = (n) => `6c4a8d9e-0000-4000-8000-${String(n).padStart(12, "0")}`;
const KIDS = { smart: kid(1), malaria: kid(2), split: kid(3) };

// Each KID's split between organizations (ids from the cause area fixture)
const SPLITS = {
  [KIDS.smart]: [[1, 100]],
  [KIDS.malaria]: [[2, 100]],
  [KIDS.split]: [
    [2, 50],
    [3, 50],
  ],
};

// [KID, kroner, payment method, date]
const DONATIONS = [
  [KIDS.split, 1000, "Bank transfer", "2023-02-14T10:00:00.000Z"],
  [KIDS.malaria, 300, "MobilePay", "2024-01-05T10:00:00.000Z"],
  [KIDS.malaria, 300, "MobilePay", "2024-02-05T10:00:00.000Z"],
  [KIDS.malaria, 300, "MobilePay", "2024-03-05T10:00:00.000Z"],
  [KIDS.smart, 2500, "Credit card", "2024-11-28T10:00:00.000Z"],
  [KIDS.malaria, 300, "MobilePay", "2025-01-05T10:00:00.000Z"],
  [KIDS.split, 1500, "Bank transfer", "2025-06-01T10:00:00.000Z"],
];

// Kroner per output, roughly; the real backend computes impact from its own tables
const COST_PER_OUTPUT = { 2: ["Myggenet", 40], 3: ["Vitamin A-tilskud", 12] };

const donations = DONATIONS.map(([KID, sum, paymentMethod, timestamp], i) => ({
  id: i + 1,
  donor: "",
  donorId: 0,
  email: "donor@example.org",
  sum,
  transactionCost: 0,
  paymentMethod,
  KID,
  taxUnitId: 1,
  timestamp,
  impact: SPLITS[KID].map(([orgId, share]) => {
    const amount = (sum * share) / 100;
    const [unit, cost] = COST_PER_OUTPUT[orgId] ?? [null, null];
    return {
      recipient: orgName(orgId),
      unit,
      organization: orgName(orgId),
      amount,
      count: cost ? Math.round((amount / cost) * 10) / 10 : null,
    };
  }),
}));

const aggregated = Object.values(
  donations.reduce((rows, d) => {
    const year = new Date(d.timestamp).getFullYear();
    for (const [orgId, share] of SPLITS[d.KID]) {
      const key = `${year}-${orgId}`;
      rows[key] ??= { organization: orgName(orgId), value: 0, year };
      rows[key].value += (d.sum * share) / 100;
    }
    return rows;
  }, {}),
);

const distribution = (KID) => {
  const amount = donations.filter((d) => d.KID === KID).reduce((s, d) => s + d.sum, 0);
  return {
    id: KID,
    kid: KID,
    donorId: 0,
    taxUnitId: 1,
    causeAreas: [
      {
        id: 1,
        name: causeAreas[0].name,
        standardSplit: KID === KIDS.smart,
        amount,
        percentageShare: 100,
        organizations: SPLITS[KID].map(([id, percentageShare]) => ({
          id,
          name: orgName(id),
          amount: (amount * percentageShare) / 100,
          percentageShare,
        })),
      },
    ],
  };
};

const total = donations.reduce((s, d) => s + d.sum, 0);
const taxUnits = [
  {
    id: 1,
    donorId: 0,
    name: "Testdonor",
    ssn: "",
    registered: "2023-02-14T10:00:00.000Z",
    archived: null,
    sumDonations: total,
    numDonations: String(donations.length),
    taxDeductions: [2023, 2024, 2025].map((year) => {
      const sum = donations
        .filter((d) => new Date(d.timestamp).getFullYear() === year)
        .reduce((s, d) => s + d.sum, 0);
      return { year, sumDonations: sum, deduction: sum, benefit: Math.round(sum * 0.26) };
    }),
  },
];

const profile = {
  id: 0,
  email: "donor@example.org",
  name: "Testdonor",
  newsletter: false,
  registered: "2023-02-14T10:00:00.000Z",
};

// Agreements (GET /donors/:id/recurring/, changed with PUT …/recurring?id= and …/recurring/cancel?id=).
// Kept in memory, so changes show until the stub restarts.
const agreements = [
  {
    id: "agr-1",
    kid: KIDS.malaria,
    bank_msg: "",
    cancelled: false,
    amount: 300,
    chargeDay: 5,
    createdAt: "2024-01-05T10:00:00.000Z",
    method: "MobilePay",
    is_payment_expired: false,
  },
  {
    id: "agr-2",
    kid: KIDS.split,
    bank_msg: "",
    cancelled: true,
    amount: 1500,
    chargeDay: 1,
    createdAt: "2023-02-14T10:00:00.000Z",
    method: "Bank transfer",
    is_payment_expired: false,
  },
];

const ok = (content) => [200, { status: 200, content }];

const change = (method, url, authorized, body) => {
  const donor = url.pathname.replace(/\/+$/, "").match(/^\/donors\/\d+\/recurring(\/cancel)?$/);
  if (method !== "PUT" || !donor)
    return [405, { status: 405, content: "Not supported by the stub" }];
  if (!authorized) return [401, { status: 401, content: "Unauthorized" }];
  const agreement = agreements.find((a) => a.id === url.searchParams.get("id"));
  if (!agreement) return [404, { status: 404, content: "Agreement not found" }];
  if (donor[1]) {
    agreement.cancelled = true;
  } else {
    if (body.amount != null) agreement.amount = body.amount;
    if (body.chargeDay != null) agreement.chargeDay = body.chargeDay;
  }
  return ok(agreement);
};

const route = (url, authorized) => {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/causeareas/all") return ok(causeAreas);
  if (path === "/organizations/all") return ok(organizations);
  const donor = path.match(/^\/donors\/\d+(\/.*)?$/);
  if (!donor) return [404, { status: 404, content: "Not found" }];
  if (!authorized) return [401, { status: 401, content: "Unauthorized" }];
  switch (donor[1] ?? "") {
    case "":
      return ok(profile);
    case "/donations":
      return ok(donations);
    case "/donations/aggregated":
      return ok(aggregated);
    case "/taxunits":
      return ok(taxUnits);
    case "/recurring":
      return ok(agreements);
    case "/distributions": {
      const kids = url.searchParams.get("kids")?.split(",") ?? Object.values(KIDS);
      return ok(kids.filter((k) => SPLITS[k]).map(distribution));
    }
    default:
      return [404, { status: 404, content: "Not found" }];
  }
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  const authorized = /^Bearer \S+/.test(req.headers.authorization ?? "");
  let requestBody = {};
  if (req.method !== "GET") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      requestBody = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    } catch {
      requestBody = {};
    }
  }
  const [status, body] =
    req.method === "GET"
      ? route(url, authorized)
      : change(req.method, url, authorized, requestBody);
  // Logs the route only, never the token
  console.log(`${req.method} ${url.pathname} ${status}`);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization, content-type",
  });
  res.end(JSON.stringify(body));
}).listen(port, () => console.log(`Danish backend stub on http://localhost:${port}`));
