import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";
import { exchangeRatesFixture, impactFixtures } from "../impact-fixtures";

/** The Impact pages against a stubbed API: lists, filters in the URL, panels, read-only views. */
async function signIn(
  page: Page,
  {
    overrides = {},
    extra = {},
  }: {
    overrides?: Record<string, (input: unknown) => unknown>;
    extra?: Record<string, unknown>;
  } = {},
) {
  await stubAnalysisApi(page, { overrides, extra: { ...impactFixtures(), ...extra } });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
}

test("the Impact group follows Regranting in the nav", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of [
    "Cost estimates",
    "Fund grants",
    "Charities & interventions",
    "Exchange rates",
  ])
    await expect(nav.getByRole("link", { name })).toBeVisible();
  const text = await nav.innerText();
  expect(text.indexOf("Impact")).toBeGreaterThan(text.indexOf("Payees & funds"));
  expect(text.indexOf("Impact")).toBeLessThan(text.indexOf("Analysis"));
});

test("estimates filter by charity and year in the URL, and a row opens the charity's timeline", async ({
  page,
}) => {
  const inputs: unknown[] = [];
  await signIn(page, {
    overrides: {
      "impact.estimates.list": (input) => {
        inputs.push(input);
        return impactFixtures()["impact.estimates.list"];
      },
    },
  });
  await page.goto("/impact/estimates?charity=1&year=2022");
  const table = page.getByRole("table", { name: "Cost estimates" });
  await expect(table).toContainText("Against Malaria Foundation");
  expect(inputs.at(-1)).toEqual({ charityIds: [1], year: 2022 });
  await expect(table).toContainText("5,85 USD");
  await expect(table).toContainText("58,50 kr");
  await expect(table).toContainText("From Jan 2023");
  await expect(table).toContainText("Jan 2021 – Dec 2022");

  await table
    .getByRole("row", { name: /Against Malaria Foundation/ })
    .first()
    .click();
  const panel = page.getByRole("region", { name: "Charity #1 estimates", exact: true });
  await expect(panel.getByRole("heading", { name: "Against Malaria Foundation" })).toBeVisible();
  const estimates = panel.getByRole("table", { name: "Estimates" });
  // Newest first, with the months each covers
  await expect(estimates.getByRole("row").nth(1)).toContainText("From Jan 2023");
  await expect(estimates.getByRole("row").nth(1)).toContainText("In effect");
  await expect(estimates.getByRole("row").nth(3)).toContainText("Jan 2020 – Dec 2020");
  await expect(panel).toContainText("Donations before Jan 2020 have no estimate");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(/charity=1/);
});

test("a fund grant shows its split by charity and each allotment's cost per output", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/grants");
  const table = page.getByRole("table", { name: "Fund grants" });
  await expect(table).toContainText("Malaria Consortium, Against Malaria Foundation");
  await table.getByRole("row", { name: /TCF/ }).click();
  const panel = page.getByRole("region", { name: "Fund grant #33", exact: true });
  await expect(panel.getByRole("heading", { name: "Top Charities Fund, Feb 2025" })).toBeVisible();
  await expect(panel.getByRole("img", { name: /Malaria Consortium/ })).toBeVisible();
  const allotments = panel.getByRole("table", { name: "Allotments" });
  await expect(allotments).toContainText("71,2 %");
  await expect(allotments).toContainText("9,62 USD");
  await expect(panel.getByRole("link", { name: "Previous grant" })).toHaveAttribute(
    "href",
    "/impact/grants/29",
  );
});

test("charities and interventions show links, abbreviations and texts per language", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/settings");
  const charities = page.getByRole("table", { name: "Charities" });
  await expect(charities).toContainText("AMF");
  await expect(charities.getByRole("row", { name: /Malaria Consortium/ })).toContainText(
    "Not linked",
  );
  await page.getByRole("button", { name: /Interventions/ }).click();
  await expect(page).toHaveURL(/section=interventions/);
  const interventions = page.getByRole("table", { name: "Interventions" });
  await expect(interventions.getByRole("row", { name: /Bednets/ })).toContainText("Myggnett");
});

test("exchange rates show the newest rate per currency and link the job's runs", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/impact/exchange-rates");
  await expect(page.getByRole("table", { name: "Currencies" })).toContainText("10,1235");
  await expect(page.getByRole("link", { name: /30\.10\.2026/ })).toHaveAttribute(
    "href",
    "/logs/900",
  );
  await expect(page.getByText("The rates are behind")).toBeHidden();
});

test("exchange rates warn when the newest rate is more than four days old", async ({ page }) => {
  await signIn(page, {
    extra: {
      "impact.exchangeRates": exchangeRatesFixture({
        daysSinceLatest: 9,
        gaps: [{ from: "2026-10-01", to: "2026-10-08", days: 8 }],
      }),
    },
  });
  await page.goto("/impact/exchange-rates");
  await expect(page.getByText("The rates are behind")).toBeVisible();
  await expect(page.getByText("(8 days)")).toBeVisible();
});
