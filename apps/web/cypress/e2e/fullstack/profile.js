/**
 * Full-stack Min Side profile: the profile is read (tRPC minside.profile) and saved
 * (minside.updateProfile) through the real API and database, for the e2e donor written by
 * apps/api/prisma/e2e/seed.mjs ("E2E Testgiver", no newsletter). The data is reset before every test.
 */
import { DONOR_ID } from "../../../../../apps/api/prisma/e2e/data.mjs";

describe("Profile page (full stack)", () => {
  beforeEach(() => {
    cy.task("resetE2EData");
    cy.loginFullstack(DONOR_ID);

    cy.visit("/min-side/profil/");
  });

  it("saves the donor's name and newsletter choice", () => {
    cy.get("#name").should("have.value", "E2E Testgiver");
    cy.get("#name").clear().type("E2E Endret");
    cy.get("[data-cy=checkbox-newsletter]").click();

    cy.get("[data-cy=btn-save]").click();
    cy.get(".Toastify").contains("Lagret");

    // Stored: a reload reads it back from the API
    cy.reload();
    cy.get("#name").should("have.value", "E2E Endret");
  });

  it("refuses an empty name", () => {
    cy.get("#name").clear();

    cy.get("[data-cy=btn-save]").click();
    cy.get(".Toastify__toast--error").should("be.visible");

    cy.reload();
    cy.get("#name").should("have.value", "E2E Testgiver");
  });
});
