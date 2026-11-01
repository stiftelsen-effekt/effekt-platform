import { isTrpcBatch, trpcPaths, trpcUrl } from "./trpc";
import "cypress-localstorage-commands";

Cypress.Commands.add("login", () => {
  Cypress.log({
    name: "loginAuth0",
  });

  // Cypress 16 removed Cypress.env(); credentials are read with cy.env(),
  // which fetches only the requested keys from the Node process.
  cy.env(["AUTH_DOMAIN", "AUTH_USERNAME", "AUTH_PASSWORD"]).then(
    ({ AUTH_DOMAIN, AUTH_USERNAME, AUTH_PASSWORD }) => {
      // Log in through Auth0 Universal Login once per Cypress process (i.e. once
      // per CI container); later specs restore the cached session instead.
      cy.session(
        AUTH_USERNAME,
        () => {
          cy.visit({
            url: "/min-side/",
            headers: {
              "x-vercel-skip-toolbar": "1",
            },
          });

          cy.origin(
            `https://${AUTH_DOMAIN}`,
            { args: { username: AUTH_USERNAME, password: AUTH_PASSWORD } },
            ({ username, password }) => {
              // Click before typing: the login form re-renders while typing, which
              // otherwise sends the password keystrokes to the username field.
              cy.get("input#username").click().type(username);
              cy.get("input#username").should("have.value", username);
              cy.get("input#password").click().type(password, { log: false });
              cy.get("input#password").should(($input) => {
                expect($input.val().length, "password length").to.equal(password.length);
              });
              cy.get("button[type=submit][name=action][value=default]").click();
            },
          );

          cy.location("pathname").should("include", "/min-side");
          cy.getCookies().should((cookies) => {
            expect(cookies.some(isAuthenticatedCookie)).to.equal(true);
          });
        },
        {
          cacheAcrossSpecs: true,
          validate() {
            // Re-run the login if the cached session cookie is gone or expired
            cy.getCookies().should((cookies) => {
              expect(cookies.some(isAuthenticatedCookie)).to.equal(true);
            });
          },
        },
      );
    },
  );

  cy.ignorePlausibleTracking();
});

/**
 * Full-stack suite only (cypress-fullstack.config.ts): logs in as `donorId` through the local
 * OIDC issuer from compose.e2e.yml. Its login form takes any username plus extra claims as JSON;
 * the numeric user-id claim is what the website and the API read.
 */
Cypress.Commands.add("loginFullstack", (donorId) => {
  Cypress.log({ name: "loginFullstack", message: donorId });

  cy.session(
    ["fullstack", donorId],
    () => {
      cy.visit("/min-side/");

      cy.origin(Cypress.expose("E2E_AUTH_ORIGIN"), { args: { donorId } }, ({ donorId }) => {
        cy.get("input[name=username]").type(`e2e-donor-${donorId}`);
        cy.get("textarea[name=claims]").type(
          JSON.stringify({ "https://gieffektivt.no/user-id": donorId }),
          { parseSpecialCharSequences: false, delay: 0 },
        );
        cy.get("input[type=submit]").click();
      });

      cy.location("pathname").should("include", "/min-side");
      cy.getCookies().should((cookies) => {
        expect(cookies.some(isAuthenticatedCookie)).to.equal(true);
      });
    },
    {
      validate() {
        cy.getCookies().should((cookies) => {
          expect(cookies.some(isAuthenticatedCookie)).to.equal(true);
        });
      },
    },
  );

  cy.ignorePlausibleTracking();
});

const isAuthenticatedCookie = (cookie) => /^auth0\..+\.is\.authenticated$/.test(cookie.name);

const nextWidgetPane = () => {
  // Panes stay mounted once visited, so several [data-cy=next-button]s can
  // exist at once — .last() is always the currently active pane's.
  cy.get("[data-cy=next-button]").last().click();
  cy.wait(250);
};

const prevWidgetPane = () => {
  cy.get("[data-cy=back-button]").click();
  cy.wait(250);
};

const checkNextIsDisabled = () => {
  cy.get("[data-cy=next-button]").last().should("have.css", "opacity", "0.5");
};

const pickRecurringDonation = () => {
  cy.get("[data-cy=radio-recurring]").click({ force: true });
};

const pickSingleDonation = () => {
  cy.get("[data-cy=radio-single]").click({ force: true });
};

const pickAnonymous = () => {
  cy.get("[data-cy=anon-checkbox]").click();
};

/**
 * Waits until React has hydrated the page, so a click isn't lost. React attaches each element's
 * props to its DOM node (`__reactProps$…`) as it hydrates it. Content pages make no request on
 * load that could tell a test this instead (the donation widget only loads when opened).
 */
const waitForHydration = () =>
  cy.get("#__next > *", { timeout: 30000 }).should(($el) => {
    expect(Object.keys($el[0]).some((key) => key.startsWith("__reactProps$"))).to.equal(true);
  });

const clickUntilWidgetPaneOpens = (selector, attempts) => {
  cy.get(selector).should("be.visible").click();
  cy.get("[data-cy=widget-pane]").then(($pane) => {
    if ($pane.is(":visible")) return;
    if (attempts <= 1) throw new Error(`The widget pane did not open from ${selector}`);
    cy.wait(250);
    clickUntilWidgetPaneOpens(selector, attempts - 1);
  });
};

/**
 * Opens the donation widget pane with a give button. The widget, and its cause areas and referral
 * types, only load once the pane opens, so wait for those requests after this, not before.
 */
const openWidgetPane = (selector = "[data-cy=gi-button]") => {
  waitForHydration();
  clickUntilWidgetPaneOpens(selector, 10);
};

Cypress.Commands.add("waitForHydration", waitForHydration);
Cypress.Commands.add("openWidgetPane", openWidgetPane);
Cypress.Commands.add("nextWidgetPane", nextWidgetPane);
Cypress.Commands.add("prevWidgetPane", prevWidgetPane);
Cypress.Commands.add("checkNextIsDisabled", checkNextIsDisabled);
Cypress.Commands.add("pickRecurringDonation", pickRecurringDonation);
Cypress.Commands.add("pickSingleDonation", pickSingleDonation);
Cypress.Commands.add("pickAnonymous", pickAnonymous);

/**
 * Stubbed tRPC procedures of the current test: procedure path -> { data } or { error }. Min Side
 * calls the backend's tRPC router on the Norwegian site; see ./trpc.js for the request format.
 */
const trpcStubs = new Map();
/** The tRPC intercepts of the current test, in the order they were set up (see interceptTrpcPath) */
const trpcIntercepts = [];
beforeEach(() => {
  trpcStubs.clear();
  trpcIntercepts.length = 0;
});

const trpcBatchEntry = (path) => {
  const stub = trpcStubs.get(path);
  if (stub && "error" in stub) return { error: stub.error };
  if (stub) return { result: { data: stub.data } };
  return {
    error: {
      message: `${path} is not stubbed in this test`,
      code: -32603,
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path },
    },
  };
};

/**
 * Answers the requests for `path` from the stubs: queries (GET) and mutations (POST), also when
 * batched with other procedures, whose entries come from their own stubs or are errors.
 *
 * A batch matches the intercept of every procedure in it, including intercepts set up again for
 * the same procedure. Cypress runs the matching handlers from the newest to the oldest until one
 * replies, and only the ones that ran count for `cy.wait`. So only the oldest intercept of the
 * batch's procedures replies (with every entry), and the others let the request pass on to it:
 * each alias sees the request.
 */
const interceptTrpcPath = (path) => {
  const intercept = { path };
  trpcIntercepts.push(intercept);
  return cy.intercept({ url: trpcUrl(path) }, (req) => {
    if (!isTrpcBatch(req.url)) {
      // The donation widget's httpLink: one procedure, one entry, the error's own status
      const entry = trpcBatchEntry(path);
      req.reply({ statusCode: entry.error ? entry.error.data.httpStatus : 200, body: entry });
      return;
    }
    const paths = trpcPaths(req.url);
    if (trpcIntercepts.find((other) => paths.includes(other.path)) !== intercept) return;
    const body = paths.map(trpcBatchEntry);
    req.reply({ statusCode: body.some((entry) => entry.error) ? 207 : 200, body });
  });
};

/**
 * Answers the tRPC procedure `path` (a query or a mutation) with `data`. Calling it again for the
 * same path replaces the data. Returns the intercept, so `.as()` works.
 */
Cypress.Commands.add("interceptTrpc", (path, data) => {
  trpcStubs.set(path, { data });
  return interceptTrpcPath(path);
});

/** Makes the tRPC procedure `path` fail, like a server error with this code and status */
const TRPC_ERROR_CODES = { BAD_REQUEST: -32600, NOT_FOUND: -32004, INTERNAL_SERVER_ERROR: -32603 };
Cypress.Commands.add(
  "interceptTrpcError",
  (path, { code = "INTERNAL_SERVER_ERROR", httpStatus = 500, message = "Failed" } = {}) => {
    trpcStubs.set(path, {
      error: {
        message,
        code: TRPC_ERROR_CODES[code] ?? -32603,
        data: { code, httpStatus, path },
      },
    });
    return interceptTrpcPath(path);
  },
);

/**
 * Stubs the cause areas (tRPC `widget.causeAreas`), which the donation widget and Min Side's
 * `useCauseAreas` both load. Returns the intercept, so `.as()` works.
 */
Cypress.Commands.add("interceptCauseAreas", (causeAreas) =>
  cy.interceptTrpc("widget.causeAreas", causeAreas),
);

Cypress.Commands.add("interceptDonorProfile", (donor) =>
  cy.interceptTrpc("minside.profile", donor),
);

Cypress.Commands.add("ignorePlausibleTracking", () => {
  cy.window().then((win) => {
    win.localStorage.setItem("plausible_ignore", "true");
  });
});
