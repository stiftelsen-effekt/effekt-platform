// Smoke test of the Swedish site: the home page and a content page render, and the donate
// button sends the donor to the external donation widget configured in Sanity (Sweden's CRM).
// Asserts on structure (data-cy, links), not on Sanity copy.
const visit = (url) =>
  cy.visit({
    url,
    headers: { "x-vercel-skip-toolbar": "1" },
  });

describe("ge-effektivt smoke", () => {
  it("renders the home page", () => {
    visit("/");
    cy.get("[data-cy=header]").should("be.visible");
    cy.get("[data-cy=navbar] a[href='/om-oss']").should("exist");
    cy.get("main, #__next").should("not.be.empty");
  });

  it("renders a content page", () => {
    cy.request("/om-oss").its("status").should("eq", 200);
    visit("/om-oss");
    cy.get("[data-cy=header]").should("be.visible");
    cy.get("h1, h2").should("have.length.greaterThan", 0);
  });

  it("sends the donate button to the external donation widget", () => {
    visit("/");
    const siteHost = new URL(Cypress.config("baseUrl")).host;
    cy.get("[data-cy=gi-button]").should("be.visible").click();
    // chromeWebSecurity is off in cypress-se.config.ts, so the test can follow the navigation
    // to the widget's host.
    cy.location("protocol", { timeout: 20000 }).should("eq", "https:");
    cy.location("host", { timeout: 20000 }).should("not.eq", siteHost);
  });
});
