describe("Widget referral code", () => {
  beforeEach(() => {
    cy.fixture("cause_areas").then((causeAreas) => {
      cy.interceptCauseAreas(causeAreas).as("getCauseAreas");
    });

    cy.fixture("referrals").then((referrals) => {
      cy.interceptTrpc("widget.referralTypes", referrals).as("getReferrals");
    });

    cy.interceptTrpc("widget.registerDonation", {
      KID: "87397824",
      donorID: 1464,
      hasAnsweredReferral: false,
      paymentProviderUrl: "",
    }).as("registerDonation");

    cy.interceptTrpc("widget.registerBankPending", true).as("bankPending");

    cy.visit({
      url: "/",
      qs: { referral: "match-2026" },
      headers: {
        "x-vercel-skip-toolbar": "1",
      },
    });
    cy.openWidgetPane();
    cy.wait("@getCauseAreas");
  });

  it("preserves the referral query param for the session", () => {
    cy.visit("/");
    cy.openWidgetPane();
    cy.wait("@getCauseAreas");

    cy.pickSingleDonation();
    cy.get("[data-cy^=donation-sum-input]").type("500");
    cy.nextWidgetPane();

    cy.pickAnonymous();
    cy.get("[data-cy=payment-method-bank]").click({ force: true });
    cy.nextWidgetPane();

    cy.wait("@registerDonation").then((interception) => {
      expect(interception.request.body.referralCode).to.equal("match-2026");
    });
  });
});
