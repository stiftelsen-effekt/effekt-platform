import { describe, it, afterEach } from "vitest";
import { expect } from "chai";
import { readFileSync } from "fs";
import { join } from "path";
import type { Request, Response } from "express";
import sinon from "sinon";
import {
  centsOf,
  grantType,
  monthOf,
  organizationKey,
  parseAgfPage,
  parseAirtableCsv,
  parseCsv,
  parseGrantPage,
  parseImpactEstimates,
  parseMetricsAgf,
} from "../../scripts/agf-grants";
import { DAO } from "../custom_modules/DAO";
import { appRouter } from "../trpc/router";
import { createCallerFactory } from "../trpc/trpc";

/**
 * GiveWell's All Grants Fund as reference data (docs/impact-givewell-numbers.md › All Grants Fund
 * grants): the importer's parsers on trimmed copies of GiveWell's pages and sheets, the data
 * migration it generated, and the admin's read-only procedures.
 */

describe("agf-grants importer: parsing", () => {
  it("reads amounts, months and organisation names the ways GiveWell writes them", () => {
    expect(centsOf("$1,281,869")).to.equal(128186900);
    expect(centsOf("$1.9", "million")).to.equal(190000000);
    expect(centsOf("$4.8", "mil")).to.equal(480000000);
    expect(centsOf("$23.6", "m")).to.equal(2360000000);
    expect(centsOf(undefined)).to.equal(null);
    expect(monthOf("June 2025")).to.equal("2025-06-01");
    expect(monthOf("Nov 2022")).to.equal("2022-11-01");
    expect(monthOf("no date")).to.equal(null);
    expect(organizationKey("Clinton Health Access Initiative, Inc.")).to.equal(
      "Clinton Health Access Initiative",
    );
    expect(organizationKey("CHAI")).to.equal("Clinton Health Access Initiative");
    expect(organizationKey("Helen Keller International")).to.equal("Helen Keller Intl");
    expect(organizationKey("Evidence Action's Deworm the World")).to.equal("Evidence Action");
    expect(organizationKey("The Taimaka Project")).to.equal("The Taimaka Project");
    expect(organizationKey("Some New Org Inc")).to.equal("Some New Org");
    expect(grantType("Hospital for Sick Children – RCT of F35 Therapeutic Milk")).to.equal(
      "research",
    );
    expect(grantType("Zipline — Desk-Based Scoping of Drones")).to.equal("scoping");
    expect(grantType("ALIMA — Malnutrition Treatment in Chad")).to.equal("program");
  });

  it("parses quoted CSV with commas and newlines", () => {
    expect(parseCsv('a,"b, c","d\n""e"""\n1,2,3\n')).to.deep.equal([
      ["a", "b, c", 'd\n"e"'],
      ["1", "2", "3"],
    ]);
  });

  it("reads a metrics report's AGF table by organisation and programme, and its total", () => {
    const csv = [
      ",2024 All Grants Fund Grants Summary,,,,",
      ",Funds Directed from the All Grants Fund,,,,",
      ",Organization + Program,,Total Grants,Portion of Total,",
      ',PATH - malaria vaccines,,"$17,367,272",45%,',
      ',CHAI - tuberculosis contact management,,"$5,000,000",13%,',
      ',Total,,"$22,367,272",100%,',
      ",,,,,",
      ",Funds directed to Top Charities including source of funding,,,,",
      ',Against Malaria Foundation - insecticide-treated nets,"$0","$1","$1",50%',
    ].join("\n");
    const parsed = parseMetricsAgf(csv, 2024);
    expect(parsed.totalCents).to.equal(2236727200);
    expect(parsed.sumCents).to.equal(parsed.totalCents);
    expect(parsed.rows.map((r: any) => [r.organizationKey, r.program, r.rowKey])).to.deep.equal([
      ["PATH", "malaria vaccines", "path-malaria-vaccines"],
      [
        "Clinton Health Access Initiative",
        "tuberculosis contact management",
        "clinton-health-access-initiative-tuberculosis-contact-management",
      ],
    ]);
  });

  it("reads the 2025 report's AGF table by organisation only", () => {
    const csv = [
      ",2025 All Grants Fund Grants Summary,,,,",
      ",Organization,,Total Grants,Portion of total,",
      ',"Clinton Health Access Initiative, Inc.",,"$16,873,748",13%,',
      ',Total,,"$16,873,748",100%,',
    ].join("\n");
    const [row] = parseMetricsAgf(csv, 2025).rows;
    expect(row.program).to.equal(null);
    expect(row.organization).to.equal("Clinton Health Access Initiative, Inc.");
    expect(row.rowKey).to.equal("clinton-health-access-initiative");
  });

  it("reads a grant page: month, amount, cost-effectiveness and deaths averted", () => {
    const html = `<html><head><title>ALIMA – Primary Healthcare in Far North Cameroon (June 2025) | GiveWell</title></head>
      <body><p>Menu</p><h2>In a nutshell</h2><p>In June 2025, GiveWell recommended a $1.9 million grant to ALIMA.</p>
      <p>Our funding threshold of 10 times as cost-effective as unconditional cash transfers.</p>
      <p>Our best guess is that this program is 7 to 11 times as cost-effective as unconditional cash transfers.</p>
      <p>We estimate it will result in an estimated 433 deaths averted.</p><p>Published: February 2026</p></body></html>`;
    const g = parseGrantPage(html, "ALIMA-Cameroon-June-2025");
    expect(g).to.include({
      title: "ALIMA – Primary Healthcare in Far North Cameroon (June 2025)",
      organizationKey: "ALIMA",
      recommendedMonth: "2025-06-01",
      publishedMonth: "2026-02-01",
      amountCents: 190000000,
      amountExact: false,
      ceLow: 7,
      ceHigh: 11,
      ceBenchmark: "unconditional cash transfers",
      deathsAverted: 433,
      grantType: "program",
    });
  });

  it("leaves figures out when a page states none", () => {
    const g = parseGrantPage(
      "<title>Atlas AI – Estimating Subnational Populations (February 2026) | GiveWell</title><p>In a nutshell</p><p>A small grant.</p>",
      "Atlas-AI",
    );
    expect(g).to.include({
      recommendedMonth: "2026-02-01",
      amountCents: null,
      ceLow: null,
      deathsAverted: null,
      grantType: "research",
    });
  });

  it("reads the AGF page's selected grants", () => {
    const html = `<article class="node node--type-grant node--view-mode-panel">
      <time datetime="2024-06-02T12:00:00Z" class="datetime">June 2024</time>
      <h3 class="recipient"><a href="/node/4093" target="_blank"><p>Clinton Health Access Initiative</p></a></h3>
      <div class="field field--name-field-grant-subtitle"><em> for a program to prevent tuberculosis </em></div>
      <div class="field field--name-field-grant-amount"><div class="field__label">Grant amount:</div><span> $15,092,329 </span></div>
      <div class="field field--name-field-locations"><div class="field__label">Location:</div><strong> Uttar Pradesh and Bihar,   India </strong></div>
      </article>`;
    expect(parseAgfPage(html)).to.deep.equal([
      {
        month: "2024-06-01",
        href: "/node/4093",
        recipient: "Clinton Health Access Initiative",
        purpose: "for a program to prevent tuberculosis",
        amountCents: 1509232900,
        location: "Uttar Pradesh and Bihar, India",
      },
    ]);
  });

  it("reads the AGF rows of the impact estimates sheet with outputs and cost per output", () => {
    const header = ",".repeat(24);
    const row = [
      "AGF New Incentives Nov 2022",
      "All Grants Fund (AGF)",
      "",
      "New Incentives",
      "Nigeria program expansion",
      "Link",
      "N/A",
      "N/A",
      "November 2022",
      "2022",
      '"$5,668,335"',
      '"$5,668,335"',
      "Incentives for immunizations",
      "Number of infants vaccinated",
      "Lives saved",
      "$128",
      '"44,419"',
      '"$5,025"',
      '"1,128"',
    ].join(",");
    const other = row.replace("All Grants Fund (AGF)", "Top Charities Fund (TCF)");
    const [ie, ...rest] = parseImpactEstimates([header, row, other].join("\n"));
    expect(rest).to.have.length(0);
    expect(ie).to.include({
      organizationKey: "New Incentives",
      month: "2022-11-01",
      fundAmountCents: 566833500,
      outputs: 44419,
      centsPerOutput: 12800,
      deathsAverted: 1128,
    });
  });

  it("reads a grants database CSV and stops on unknown columns", () => {
    const csv =
      'Grant,Recipient,Funder,Amount,Date,Link\n"X — Y",X,"All Grants Fund, Unrestricted Fund","$10,000",2025-03-01,https://www.givewell.org/research/grants/x-y\n';
    expect(parseAirtableCsv(csv)).to.deep.equal([
      {
        name: "X — Y",
        slug: "x-y",
        organization: "X",
        funders: ["All Grants Fund", "Unrestricted Fund"],
        amountCents: 1000000,
        month: "2025-03-01",
      },
    ]);
    expect(() => parseAirtableCsv("Foo,Bar\n1,2\n")).to.throw(/no "name" column/);
  });
});

describe("agf-grants data migration", () => {
  const dir = join(__dirname, "../../prisma/migrations");
  const tables = readFileSync(join(dir, "20261101230000_impact_agf_tables/migration.sql"), "utf8");
  const data = readFileSync(join(dir, "20261101230100_impact_agf_data/migration.sql"), "utf8");
  const code = (sql: string) => sql.replace(/^--.*$/gm, "");

  it("only adds the two tables, and the data only touches them and the history", () => {
    expect(code(tables)).not.to.match(
      /^\s*(DROP|UPDATE|DELETE|RENAME)\b|\b(DROP|MODIFY) COLUMN\b/im,
    );
    expect([...code(tables).matchAll(/CREATE TABLE `(\w+)`/g)].map((m) => m[1])).to.deep.equal([
      "Impact_fund_portfolio",
      "Impact_givewell_grants",
    ]);
    const writes = [...code(data).matchAll(/^(INSERT INTO|UPDATE) `(\w+)`/gm)].map((m) => m[2]);
    expect([...new Set(writes)].sort()).to.deep.equal([
      "Impact_changes",
      "Impact_fund_portfolio",
      "Impact_givewell_grants",
    ]);
    expect(code(data)).not.to.match(/^\s*(DROP|DELETE|ALTER)\b/im);
    expect(code(data)).not.to.match(/Impact_grants|Impact_evaluations|Impact_grant_allotments/);
  });

  it("carries each year's AGF total from GiveWell's metrics reports", () => {
    const start = data.indexOf("INSERT INTO `Impact_fund_portfolio`");
    const block = data.slice(start, data.indexOf("AS new", start));
    const totals: Record<string, number> = {};
    for (const [, year, cents] of block.matchAll(
      /^ {2}\('AGF', (\d{4}), .*?, (\d+), 'GiveWell metrics/gm,
    ))
      totals[year] = (totals[year] ?? 0) + Number(cents);
    // The reports' totals; 2025's rows add up to $1 less than its rounded total
    expect(totals).to.deep.equal({
      "2022": 1548265300,
      "2023": 2444832700,
      "2024": 3837629800,
      "2025": 12959556700,
    });
  });

  it("keeps rows edited in the admin and records who added the rows", () => {
    expect(data).to.match(/IF\(`Impact_givewell_grants`\.updated_by IS NULL, new\.`title`/);
    expect(data).to.include("'migration:20261101230100_impact_agf_data'");
    expect(data).to.match(/SELECT 'givewell_grant', t\.ID, 'create'/);
  });
});

describe("impact.agf procedures", () => {
  const createCaller = createCallerFactory(appRouter);
  const caller = (permissions?: string[]) =>
    createCaller({
      req: {} as Request,
      res: {} as Response,
      auth: permissions ? { permissions, email: "ops@example.org" } : undefined,
    }).impact.agf;

  afterEach(() => sinon.restore());

  it("needs the admin role", async () => {
    for (const permissions of [undefined, ["read:profile"]]) {
      try {
        await caller(permissions).grants();
        expect.fail("expected an error");
      } catch (err: any) {
        expect(["UNAUTHORIZED", "FORBIDDEN"]).to.include(err.code);
      }
    }
  });

  it("lists grants with figures as numbers and whether GiveWell published any", async () => {
    sinon.stub(DAO, "query").resolves([
      [
        {
          ID: 1,
          slug: "x",
          title: "X — Y (June 2025)",
          organization: "X",
          organization_key: "X",
          Organization_ID: null,
          organization_name: null,
          location: null,
          grant_type: "program",
          recommended_month: "2025-06-01",
          published_month: null,
          amount_cents: "190000000",
          amount_exact: 0,
          funders: "AGF",
          fund_amount_cents: null,
          ce_low: "7.00",
          ce_high: "11.00",
          ce_benchmark: "unconditional cash transfers",
          outputs: null,
          output_unit: null,
          cents_per_output: null,
          deaths_averted: null,
          sources: "grant_page,agf_page",
          source_url: "https://www.givewell.org/research/grants/x",
          notes: null,
          created_at: new Date("2026-11-01T12:00:00Z"),
          created_by: "migration:20261101230100_impact_agf_data",
          updated_at: null,
          updated_by: null,
        },
      ],
      [],
    ] as any);
    const [g] = await caller(["admin"]).grants();
    expect(g).to.include({
      amountCents: 190000000,
      amountExact: false,
      ceLow: 7,
      ceHigh: 11,
      funders: "AGF",
      hasFigures: true,
    });
    expect(g.sources).to.deep.equal(["grant_page", "agf_page"]);
  });
});
