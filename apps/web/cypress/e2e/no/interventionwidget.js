describe("InterventionWidget", () => {
  beforeEach(() => {
    // The widget's cost per output: site.impactCosts on the Norwegian API (httpLink, unbatched)
    cy.fixture("impact_costs").then((costs) => {
      cy.interceptTrpc("site.impactCosts", costs).as("getImpactCosts");
    });

    cy.visit({
      url: "/",
      headers: {
        "x-vercel-skip-toolbar": "1",
      },
    });
  });

  it("Should by default show more than 0 intervention output", () => {
    cy.wait("@getImpactCosts").its("response.statusCode").should("eq", 200);

    cy.get("[data-cy=impact-input]").scrollIntoView();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.gt", 0);
    cy.get("[data-cy=A-vitamin-button]").click();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.gt", 0);
    cy.get("[data-cy=Vaksinering-button]").click();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.gt", 0);
  });

  it("Should divide the sum by the cost per output", () => {
    cy.wait("@getImpactCosts");
    cy.get("[data-cy=impact-input]").scrollIntoView();
    cy.get("[data-cy=impact-input]").clear().type("5850");
    cy.get("[data-cy=Myggnett-button]").click();
    // 5 850 kr / 58,50 kr per net (fixtures/no/impact_costs.json)
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.equal", 100);
  });

  it("0 NOK should give 0 interventions output", () => {
    cy.wait("@getImpactCosts").its("response.statusCode").should("eq", 200);

    cy.get("[data-cy=impact-input]").scrollIntoView();
    cy.get("[data-cy=impact-input]").clear();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.equal", 0);
    cy.get("[data-cy=A-vitamin-button]").click();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.equal", 0);
    cy.get("[data-cy=Myggnett-button]").click();
    cy.get("[data-cy=impact-output]").invoke("text").then(parseFloat).should("be.equal", 0);
  });
});
