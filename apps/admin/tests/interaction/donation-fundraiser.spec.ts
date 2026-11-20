import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Moving a donation into a fundraiser and out of it again from the donation page. The page sends
 * the fundraiser, message and name to the API, which moves just this donation to a KID of the
 * fundraiser. Synthetic donor, numbers and amounts.
 */
const causeAreas = [
  {
    id: 1,
    name: "Global health",
    standardPercentageShare: 100,
    shortDescription: null,
    longDescription: null,
    informationUrl: null,
    isActive: true,
    ordering: 1,
    organizations: [
      {
        id: 1,
        causeAreaId: 1,
        name: "Against Malaria Foundation",
        standardShare: 100,
        isActive: true,
        ordering: 1,
      },
    ],
  },
];

const split = {
  kid: "70000001",
  donorId: 700,
  taxUnitId: null,
  causeAreas: [
    {
      id: 1,
      name: "Global health",
      percentageShare: "100.000000000000000",
      standardSplit: true,
      organizations: [
        { id: 1, name: "Against Malaria Foundation", percentageShare: "100.000000000000000" },
      ],
    },
  ],
};

const donation = {
  id: 20002,
  donor: "Ola Eksempel",
  donorId: 700,
  email: "ola@example.org",
  sum: "1500.00",
  transactionCost: "0.00",
  timestamp: "2026-10-15T10:00:00.000Z",
  paymentId: 2,
  paymentExternalRef: "bank-2",
  paymentMethod: "Bank",
  KID: split.kid,
  metaOwnerId: 3,
  fundraiserId: null as number | null,
  distribution: split,
};

const fundraiser = {
  id: 55,
  donorId: 800,
  secret: "dev-secret",
  registered: "2026-09-01T10:00:00.000Z",
  lastUpdated: "2026-09-01T10:00:00.000Z",
  totalSum: 4000,
  donationCount: 3,
  transactions: [],
};

async function open(page: Page, fundraiserId: number | null, calls: Record<string, unknown[]>) {
  await stubAnalysisApi(page, {
    extra: {
      "donations.get": { ...donation, fundraiserId },
      "config.causeAreas.listAll": causeAreas,
      "meta.owners": [{ id: 3, name: "EAN + Effekt", default: true }],
      "donors.get": { id: 800, name: "Kari Innsamler", email: "kari@example.org" },
    },
    overrides: {
      "reports.fundraisers.get": (input) =>
        (input as { id: number }).id === fundraiser.id
          ? fundraiser
          : { error: { code: "NOT_FOUND", message: "Not found", httpStatus: 404 } },
      "reports.fundraisers.attachDonation": (input) => {
        calls.attach.push(input);
        return { donationId: donation.id, fundraiserId: fundraiser.id, kid: "80000002" };
      },
      "reports.fundraisers.detachDonation": (input) => {
        calls.detach.push(input);
        return { donationId: donation.id, fundraiserId: fundraiser.id, kid: split.kid };
      },
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
  await page.goto(`/donations/${donation.id}`);
}

test("a donation is added to a fundraiser with a message and name", async ({ page }) => {
  const calls = { attach: [] as unknown[], detach: [] as unknown[] };
  await open(page, null, calls);

  await page.getByRole("button", { name: "Add to fundraiser…" }).click();
  const dialog = page.getByRole("dialog");
  const fundraiserId = dialog.getByLabel("Fundraiser ID");

  // An ID that isn't a fundraiser is caught before anything is sent
  await fundraiserId.fill("999");
  await dialog.getByRole("button", { name: "Add to fundraiser" }).click();
  await expect(dialog).toContainText("There is no fundraiser #999");

  await fundraiserId.fill("55");
  await expect(dialog.getByTestId("fundraiser-preview")).toContainText(
    "Fundraiser #55 run by Kari Innsamler · 3 donations",
  );
  await dialog.getByRole("textbox", { name: "Message" }).fill("Lykke til!");
  await dialog.getByRole("textbox", { name: "Name" }).fill("Ola");
  await dialog.getByRole("button", { name: "Add to fundraiser" }).click();

  await expect.poll(() => calls.attach.length).toBe(1);
  expect(calls.attach[0]).toEqual({
    donationId: donation.id,
    fundraiserId: 55,
    message: "Lykke til!",
    messageSenderName: "Ola",
    showName: true,
  });
  await expect(dialog).toBeHidden();
  expect(calls.detach).toEqual([]);
});

test("a donation in a fundraiser is removed from it after confirming", async ({ page }) => {
  const calls = { attach: [] as unknown[], detach: [] as unknown[] };
  await open(page, fundraiser.id, calls);

  await expect(page.getByRole("link", { name: "#55" })).toHaveAttribute("href", "/fundraisers/55");
  await expect(page.getByRole("button", { name: "Add to fundraiser…" })).toHaveCount(0);

  await page.getByRole("button", { name: "Remove from fundraiser…" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Remove donation #20002 from fundraiser #55?");
  await confirm.getByRole("button", { name: "Remove from fundraiser" }).click();

  await expect.poll(() => calls.detach.length).toBe(1);
  expect(calls.detach[0]).toEqual({ donationId: donation.id });
  await expect(confirm).toBeHidden();
});
