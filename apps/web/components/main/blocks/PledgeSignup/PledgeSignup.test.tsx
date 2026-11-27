import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PledgeSignup } from "./PledgeSignup";

describe("PledgeSignup", () => {
  it("shows GWWC's four steps with English defaults", () => {
    const html = renderToStaticMarkup(<PledgeSignup config={{ club_name: "giv-effektivt" }} />);
    for (const text of [
      "Employment status",
      "Pledge type",
      "E-mail",
      "Sign your pledge",
      "The 🔸10% Pledge",
      "The 🔹Trial Pledge",
      "Sign the pledge",
    ]) {
      expect(html).toContain(text);
    }
    // The 10% Pledge is preselected at 10%
    expect(html).toContain("give at least 10% of what I earn");
  });

  it("shows each pledge type's commitment, the Trial Pledge's filled in", () => {
    const html = renderToStaticMarkup(<PledgeSignup config={{ club_name: "giv-effektivt" }} />);
    expect(html).toContain("Give a minimum of 10% of your income, until you retire.");
    // The form starts at 10% and a 1-year trial
    expect(html).toContain("Give a minimum of 10% of your income for 1 year.");
  });

  it("uses the texts from Sanity", () => {
    const html = renderToStaticMarkup(
      <PledgeSignup
        locale="dk"
        config={{
          employment_heading: "Beskæftigelse",
          ten_percent_text: "Jeg giver {income}% fra {start_date}.",
          submit_label: "Underskriv løftet",
        }}
      />,
    );
    expect(html).toContain("Beskæftigelse");
    expect(html).toContain("Jeg giver 10% fra ");
    expect(html).toContain("Underskriv løftet");
    expect(html).not.toContain("Sign the pledge");
  });
});
