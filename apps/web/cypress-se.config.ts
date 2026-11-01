import { defineConfig } from "cypress";

// Smoke tests for the Swedish site (ge-effektivt), run against its Vercel deployments
// (docs/ci.md). Sweden's donations go through an external widget, so there is no widget suite.
export default defineConfig({
  projectId: "wfkg9n",
  chromeWebSecurity: false,
  e2e: {
    setupNodeEvents(on, config) {
      return require("./cypress/plugins/index.js")(on, config);
    },
    supportFile: "cypress/support/e2e.js",
    baseUrl: "http://localhost:3000",
    specPattern: "cypress/e2e/se/**/*.{js,jsx,ts,tsx}",
  },
  viewportHeight: 850,
  viewportWidth: 1280,
});
