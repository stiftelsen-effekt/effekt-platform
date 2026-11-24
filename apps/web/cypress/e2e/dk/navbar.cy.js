describe("Navbar", () => {
  it("supports keyboard navigation in the compact menu and closes it on desktop resize", () => {
    cy.viewport(1280, 900);
    cy.visit({ url: "/", headers: { "x-vercel-skip-toolbar": "1" } });

    cy.waitForHydration();

    cy.get("[data-cy=navbar] > ul").should("not.be.visible");
    cy.get("[data-cy=navbar-menu-toggle]").focus();
    cy.press(Cypress.Keyboard.Keys.ENTER);
    cy.get("[data-cy=navbar] > ul").should("be.visible");
    cy.get("html").should("have.css", "overflow-y", "hidden");

    cy.get("[data-cy=navbar] > ul > li > button")
      .first()
      .then(($trigger) => {
        for (let i = 0; i <= $trigger.parent().index(); i++) {
          cy.press(Cypress.Keyboard.Keys.TAB);
        }
        cy.focused().should(($focused) => {
          expect($focused[0]).to.equal($trigger[0]);
        });
      });
    cy.press(Cypress.Keyboard.Keys.ENTER);
    const submenuLink = "[data-cy=navbar] > ul > li ul a";
    cy.get(submenuLink).first().should("be.visible");
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused().should("match", submenuLink);

    cy.viewport(1281, 900);
    cy.get("[data-cy=navbar-menu-toggle]").should("have.attr", "aria-expanded", "false");
    cy.get("html").should("not.have.css", "overflow-y", "hidden");

    cy.viewport(1280, 900);
    cy.get("[data-cy=navbar] > ul").should("not.be.visible");
    cy.get("[data-cy=navbar-menu-toggle]").click();
    cy.get(submenuLink).first().should("not.be.visible");
  });

  it("keeps the desktop links and donation button on the same row", () => {
    cy.visit({ url: "/", headers: { "x-vercel-skip-toolbar": "1" } });
    cy.document().then((doc) => doc.fonts.ready);

    for (const width of [1281, 1521, 1641, 1920]) {
      cy.viewport(width, 900);
      cy.get("[data-cy=navbar-menu-toggle]").should("not.be.visible");
      cy.get("[data-cy=navbar] > ul").should("be.visible");
      cy.get("[data-cy=navbar] > ul > li").should(($items) => {
        const first = $items[0].getBoundingClientRect();
        const last = $items[$items.length - 1].getBoundingClientRect();
        expect(last.top, `action row at ${width}px`).to.be.lessThan(first.bottom);
        expect(last.left, `action column at ${width}px`).to.be.at.least(first.right);
      });
    }
  });
});
