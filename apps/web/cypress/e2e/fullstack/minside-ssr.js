import { DONOR_ID, KIDS, TAX_UNITS } from "../../../../../apps/api/prisma/e2e/data.mjs";

const unitList = (name) =>
  cy
    .get("[data-cy=generic-list]:visible")
    .filter(`:has([data-cy=generic-list-header-title]:contains("${name}"))`);

describe("Min Side server sessions", () => {
  beforeEach(() => {
    cy.task("resetE2EData");
    cy.loginFullstack(DONOR_ID);
  });

  it("renders the account pages and keeps the token out of browser storage", () => {
    cy.visit("/min-side/");
    cy.get("[data-cy=year-menu]").should("exist");
    cy.visit("/min-side/profil/");
    cy.get("#name").should("have.value", "E2E Testgiver");
    cy.visit("/min-side/avtaler/");
    cy.get("[data-cy=generic-list-header]").first().should("contain.text", "Aktive");
    cy.visit("/min-side/skatt/");
    unitList(TAX_UNITS.main.name).should("exist");
    cy.window().then((win) => {
      expect(Object.keys(win.localStorage).filter((key) => /auth|token|session/i.test(key))).to.be
        .empty;
      expect(Object.keys(win.sessionStorage).filter((key) => /auth|token|session/i.test(key))).to.be
        .empty;
      expect(win.document.cookie).not.to.contain("__session");
    });
  });

  it("saves profile changes through a server action", () => {
    cy.visit("/min-side/profil/");
    cy.get("#name").clear().type("E2E Endret");
    cy.get("[data-cy=btn-save]").click();
    cy.get(".Toastify").should("contain.text", "Lagret");
    cy.reload();
    cy.get("#name").should("have.value", "E2E Endret");
  });

  it("creates a tax unit through a server action", () => {
    cy.visit("/min-side/skatt/");
    cy.get("[data-cy=btn-create-tax-unit]").click();
    cy.get("[data-cy=lightbox]:visible input:not([type=radio])").eq(0).type("E2E Barn");
    cy.get("[data-cy=lightbox]:visible input:not([type=radio])").eq(1).type("15868520008");
    cy.get("[data-cy=lightbox]:visible [data-cy=lightbox-confirm]").click();
    unitList("E2E Barn").should("exist");
    cy.reload();
    unitList("E2E Barn").should("exist");
  });

  it("saves an agreement change through a server action", () => {
    cy.visit("/min-side/avtaler/");
    const row = () =>
      cy.get("[data-cy=generic-list-table]").first().contains("tbody", KIDS.vippsStandard);
    row().find("[data-cy=generic-list-row-expand]").first().click();
    row().find("[data-cy=date-picker-input]").click();
    row().find("[data-cy=date-picker-button-13]").click({ force: true });
    row().find("[data-cy=btn-save-agreement]").click();
    cy.get(".Toastify").should("contain.text", "Lagret");
    cy.reload();
    row().should("contain.text", "Den 13. hver måned");
  });
});
