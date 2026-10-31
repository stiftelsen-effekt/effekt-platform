import { expect, test, type Page } from "@playwright/test";
import { stubAnalysisApi } from "../analysis-fixtures";

/**
 * Inflation adjustment against a stubbed API: the preview, preparing offers (no email) and
 * sending them in batches after a confirmation that states the count.
 */
const eligible = (overrides: Record<string, unknown> = {}) => ({
  type: "avtaleGiro",
  agreementId: "167",
  donorId: 951,
  donorName: "Ola Hansen",
  email: "ola@example.org",
  currentAmount: "300.00",
  proposedAmount: "320.00",
  increase: "20.00",
  inflation: 0.0645,
  lastChange: "2024-10",
  monthsSinceChange: 24,
  ...overrides,
});

const unsent = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  type: "vipps",
  agreementId: `agr_${id}`,
  donorId: 900 + id,
  donorName: `Kari ${id}`,
  email: `kari${id}@example.org`,
  currentAmount: "200.00",
  proposedAmount: "210.00",
  increase: "10.00",
  inflation: 0.06,
  prepared: "2026-10-31T10:00:00.000Z",
  stillValid: true,
  ...overrides,
});

const totals = (count: number, monthly: string) => ({
  count,
  avtaleGiro: count,
  vipps: 0,
  monthlyIncrease: monthly,
  yearlyIncrease: (Number(monthly) * 12).toFixed(2),
});

async function signIn(page: Page, calls: { path: string; input: unknown }[]) {
  let prepared = false;
  let remaining = 30;
  await stubAnalysisApi(page, {
    overrides: {
      "inflation.overview": () => ({
        inflationUntil: "2026-09",
        eligible: prepared ? [] : [eligible(), eligible({ agreementId: "168", donorName: "Per" })],
        eligibleTotals: prepared ? totals(0, "0.00") : totals(2, "40.00"),
        skipped: {
          unknownStart: 0,
          changedRecently: 0,
          lowInflation: 0,
          smallIncrease: 0,
          noEmail: 0,
        },
        unsent: prepared
          ? [
              ...Array.from({ length: remaining }, (_, i) => unsent(i + 1)),
              unsent(99, { stillValid: false }),
            ]
          : [],
        unsentTotals: prepared ? totals(remaining, "300.00") : totals(0, "0.00"),
        statuses: [{ status: "expired", count: 360, monthlyIncrease: "1234.00" }],
        maxSendBatch: 25,
      }),
      "inflation.prepare": (input) => {
        calls.push({ path: "prepare", input });
        prepared = true;
        return { created: 30, alreadyOpen: 0, expired: 0, inflationUntil: "2026-09" };
      },
      "inflation.send": (input) => {
        calls.push({ path: "send", input });
        const batch = (input as { batchSize: number }).batchSize;
        remaining -= batch;
        return { sent: batch, failed: 0, cancelled: 0, remaining };
      },
    },
  });
  await page.goto("/login");
  await page.getByRole("button", { name: /dev token/i }).click();
  await page.waitForURL("/");
}

test("inflation adjustment: preview, prepare, then send in batches", async ({ page }) => {
  const calls: { path: string; input: unknown }[] = [];
  await signIn(page, calls);

  // Reached from ⌘K by a Norwegian word
  await page
    .getByRole("button", { name: /^Search/ })
    .first()
    .click();
  await page.getByRole("combobox").fill("prisjustering");
  await page.getByRole("option", { name: /Inflation adjustment/ }).click();
  await expect(page).toHaveURL(/\/agreements\/inflation/);
  await expect(page.getByRole("heading", { level: 1, name: "Inflation adjustment" })).toBeVisible();

  const table = page.getByRole("table", { name: "Eligible agreements" });
  await expect(table.getByRole("row")).toHaveCount(3);
  await expect(table.getByRole("row").nth(1)).toContainText("Ola Hansen");
  await expect(table.getByRole("row").nth(1)).toContainText("320,00 kr");
  await expect(page.getByText("Eligible now")).toBeVisible();

  // Nothing prepared yet: sending is disabled
  await expect(page.getByRole("button", { name: "Send 0 emails" })).toBeDisabled();

  // Prepare asks first and sends nothing
  await page.getByRole("button", { name: "Prepare 2 offers" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Nothing is emailed");
  await dialog.getByRole("button", { name: "Prepare 2 offers" }).click();
  await expect(dialog).toBeHidden();
  expect(calls.map((c) => c.path)).toEqual(["prepare"]);

  // The offer whose agreement changed isn't counted
  await page.getByRole("button", { name: "Send 30 emails" }).click();
  await expect(dialog.getByRole("heading")).toHaveText("Send 30 emails?");
  await dialog.getByLabel("How many").fill("27");
  await expect(dialog.getByRole("heading")).toHaveText("Send 27 emails?");
  await dialog.getByRole("button", { name: "Send 27 emails" }).click();

  await expect(page.getByText("Sent 27 emails")).toBeVisible({ timeout: 10_000 });
  // Batches of at most 25 per call
  expect(calls.filter((c) => c.path === "send").map((c) => c.input)).toEqual([
    { batchSize: 25 },
    { batchSize: 2 },
  ]);
});
