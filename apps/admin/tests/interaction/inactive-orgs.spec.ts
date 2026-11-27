import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Inactive organizations are hidden from donors on the website, but companies and foundations
 * still give to them: a new KID's custom split offers them after the active ones.
 */

const org = (id: number, name: string, share: number, isActive: boolean) => ({
  id,
  causeAreaId: 1,
  name,
  abbreviation: name.slice(0, 3).toUpperCase(),
  shortDescription: null,
  longDescription: "",
  informationUrl: null,
  standardShare: share,
  isActive,
  ordering: id,
  chartColor: null,
});

async function signIn(page: Page) {
  const organizations = [
    org(1, "Against Malaria Foundation", 100, true),
    org(2, "GiveDirectly", 0, true),
    org(3, "One Acre Fund", 0, false),
  ];
  const area = (orgs: typeof organizations) => ({
    id: 1,
    name: "Global Health",
    standardPercentageShare: 100,
    shortDescription: null,
    longDescription: null,
    informationUrl: null,
    isActive: true,
    ordering: 1,
    organizations: orgs,
  });
  await stubAnalysisApi(page, {
    overrides: {
      "config.causeAreas.listAll": () => [area(organizations)],
      "config.causeAreas.listActive": () => [area(organizations.filter((o) => o.isActive))],
    },
    extra: { "meta.owners": [{ id: 1, owner: "Gi Effektivt", default: true }] },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
}

test("a new KID can split between an active and an inactive organization", async ({ page }) => {
  await signIn(page);
  await page.goto("/distributions/new");

  await page.getByRole("textbox", { name: "Global Health share" }).fill("100");
  await page.getByRole("switch").click();

  const inactive = page.getByRole("textbox", { name: "One Acre Fund share of Global Health" });
  await expect(inactive).toBeVisible();
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();

  await page
    .getByRole("textbox", { name: "Against Malaria Foundation share of Global Health" })
    .fill("0");
  await page.getByRole("textbox", { name: "GiveDirectly share of Global Health" }).fill("50");
  await inactive.fill("50");
  await expect(page.getByText("All 100 % placed")).toBeVisible();
});
