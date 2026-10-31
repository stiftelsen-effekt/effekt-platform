describe("Navigation", () => {
  beforeEach(() => {
    cy.fixture("cause_areas").then((causeAreas) => {
      cy.interceptCauseAreas(causeAreas).as("getCauseAreas");
    });

    cy.fixture("referrals").then((referrals) => {
      cy.interceptTrpc("widget.referralTypes", referrals).as("getReferrals");
    });

    cy.intercept("GET", "/api/inflation", {
      statusCode: 200,
      body: 0.26558005752636626,
    }).as("getInflation");

    cy.visit({
      url: `/rikdomskalkulator`,
      headers: {
        "x-vercel-skip-toolbar": "1",
      },
    });

    cy.wait(["@getCauseAreas", "@getReferrals"]);
  });

  it("Should initialize correctly", () => {
    cy.get("[data-cy=wealthcalculator-container]").should("be.visible");

    cy.get("[data-cy=wealthcalculator-income-input]").find("input").should("be.empty");

    cy.get("[data-cy=wealthcalculator-children-input]").should("contain.text", "Ingen barn");
    cy.get("[data-cy=wealthcalculator-adults-input]").should("contain.text", "Én voksen");

    cy.get("[data-cy=wealthcalculator-graph]").should("not.contain.text", "Om du donerer");

    cy.get("[data-cy=wealthcalculator-explanation]").should("not.be.visible");
  });

  it("Should update graph when income is changed", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    // Weird symbols are a hack to get bold percentage text
    // We have some symbols in the font set to semibold numbers
    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 10% avinntekten din er du blant",
    );
    cy.get("[data-cy=wealthcalculator-graph]").should("contain.text", "Du er i dag blant");
  });

  it("Should update graph when children is changed", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=wealthcalculator-children-input]").click();
    cy.get("[data-cy=wealthcalculator-children-input]").find("[data-cy=dropdown-option-2]").click();

    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 10% avinntekten din er du blant",
    );
  });

  it("Should update graph when adults is changed", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=wealthcalculator-adults-input]").click();
    cy.get("[data-cy=wealthcalculator-adults-input]").find("[data-cy=dropdown-option-1]").click();

    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 10% avinntekten din er du blant",
    );
  });

  it("Should update graph when percentage is changed", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=wealthcalculator-donation-percentage-input]").clear().type("20");

    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 20% avinntekten din er du blant",
    );
    cy.get("[data-cy=wealthcalculator-graph]").should("contain.text", "Du er i dag blant");
  });

  it("Should allow users to slide the percentage slider", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=slider-handle]").trigger("mousedown", { which: 1 });
    cy.get("[data-cy=slider-handle]").trigger("mousemove", { clientX: 250 });
    cy.get("[data-cy=slider-handle]").trigger("mouseup");

    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 25% avinntekten din er du blant",
    );
    cy.get("[data-cy=wealthcalculator-graph]").should("contain.text", "Du er i dag blant");
    cy.get("[data-cy=wealthcalculator-donation-percentage-input]").should("have.value", "25");
  });

  it("Should allow users to tap the slider track to change percentage", () => {
    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=slider-track]").click(250, 0);

    cy.get("[data-cy=wealthcalculator-graph]").should(
      "contain.text",
      "Om du donerer 39% avinntekten din er du blant",
    );
    cy.get("[data-cy=wealthcalculator-graph]").should("contain.text", "Du er i dag blant");
    cy.get("[data-cy=wealthcalculator-donation-percentage-input]").should("have.value", "39");
  });

  it("Should be possible to expand and collapse the explanation", () => {
    cy.get("[data-cy=wealthcalculator-explanation]").should("not.be.visible");

    cy.get("[data-cy=wealthcalculator-explanation-toggle]").click();

    cy.get("[data-cy=wealthcalculator-explanation]").should("be.visible");

    cy.get("[data-cy=wealthcalculator-explanation-toggle]").click();

    cy.get("[data-cy=wealthcalculator-explanation]").should("not.be.visible");
  });

  it("Should be possible to click the create agreement button to open the widget", () => {
    cy.get("[data-cy=widget-pane]").should("not.be.visible");

    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");

    cy.get("[data-cy=wealthcalculator-impact-create-agreement-button]").click();

    cy.get("[data-cy=widget-pane]").should("be.visible");
  });

  it("Should open the widget on monthly, with the monthly donation amount prefilled", () => {
    // A fixed tax estimate, so the amount is known
    cy.intercept("POST", "/api/tax*", { statusCode: 200, body: 152000 }).as("getTax");

    cy.get("[data-cy=wealthcalculator-income-input]").find("input").type("572000");
    cy.wait("@getTax");

    cy.get("[data-cy=wealthcalculator-donation-percentage-input]")
      .invoke("val")
      .then((percentage) => {
        // A twelfth of the yearly donation from the post-tax income, rounded to the nearest 100 kr
        const yearly = Math.round(((572000 - 152000) * Number(percentage)) / 100);
        const monthly = Math.round(yearly / 12 / 100) * 100;
        expect(monthly).to.be.greaterThan(0);

        cy.get("[data-cy=wealthcalculator-impact-create-agreement-button]").click();
        cy.get("[data-cy=widget-pane]").should("be.visible");
        cy.get("[data-cy=widget-pane]")
          .find("[data-cy^=donation-sum-input-]")
          .first()
          .should(($input) => {
            expect(Number(String($input.val()).replace(/\s/g, ""))).to.equal(monthly);
          });
        // "Sett opp fast donasjon": the amount is a monthly one, so the widget opens on monthly
        cy.get("[data-cy=widget-pane]")
          .find("[data-cy=recurring-donation-radio]")
          .should("be.checked");
        cy.get("[data-cy=widget-pane]")
          .find("[data-cy=single-donation-radio]")
          .should("not.be.checked");
      });
  });
});
