import { Feather } from "react-feather";
import { defineField, defineType } from "sanity";
import { BlockTypePresets } from "../utils/blockContentHelpers";

/** A labelled choice with a short explanation, e.g. an employment status */
const option = (name: string, title: string, group: string) =>
  defineField({
    name,
    title,
    type: "object",
    group,
    options: { collapsible: true, collapsed: true },
    fields: [
      defineField({ name: "title", title: "Title", type: "string" }),
      defineField({ name: "description", title: "Description", type: "string" }),
    ],
  });

/** A pledge type as on GWWC's cards: name, one-line commitment, explanation */
const pledgeOption = (name: string, title: string, summaryHelp: string) =>
  defineField({
    name,
    title,
    type: "object",
    group: "pledge",
    options: { collapsible: true, collapsed: true },
    fields: [
      defineField({ name: "title", title: "Title", type: "string" }),
      defineField({ name: "summary", title: "Summary", type: "string", description: summaryHelp }),
      defineField({ name: "description", title: "Description", type: "string" }),
    ],
  });

const text = (name: string, title: string, group: string, description?: string) =>
  defineField({ name, title, type: "string", group, description });

/**
 * Giving What We Can pledge signup: the questions of givingwhatwecan.org/pledge, signed through
 * GWWC's API by the website's /api/pledge route. Every text is optional and falls back to
 * GWWC's English wording.
 */
export default defineType({
  name: "pledgesignup",
  type: "object",
  title: "Pledge signup (Giving What We Can)",
  icon: Feather,
  groups: [
    { name: "settings", title: "Settings", default: true },
    { name: "employment", title: "1 Employment" },
    { name: "pledge", title: "2 Pledge type" },
    { name: "contact", title: "3 E-mail" },
    { name: "sign", title: "4 Sign" },
    { name: "messages", title: "Messages" },
  ],
  fields: [
    defineField({
      name: "club_name",
      title: "GWWC club name",
      type: "string",
      group: "settings",
      description:
        "Our club's id at Giving What We Can, which they give us (e.g. giv-effektivt). Pledges are registered under it.",
      validation: (Rule) => Rule.required(),
    }),

    text("employment_heading", "Heading", "employment"),
    text("employment_question", "Question", "employment"),
    option("employed", "Employed", "employment"),
    option("student", "Student", "employment"),
    option("retired", "Retired", "employment"),
    option("unemployed", "Unemployed", "employment"),

    text("pledge_heading", "Heading", "pledge"),
    text("pledge_description", "Description", "pledge"),
    pledgeOption(
      "ten_percent",
      "🔸10% Pledge",
      "e.g. Give a minimum of 10% of your income, until you retire.",
    ),
    pledgeOption(
      "trial",
      "🔹Trial Pledge",
      "{income} and {duration} are filled in from the form, e.g. Give a minimum of {income}% of your income for {duration}.",
    ),
    text("income_label", "Income % label", "pledge"),
    text("wealth_label", "Wealth % label", "pledge"),
    text("wealth_help", "Wealth % explanation", "pledge"),
    text("start_date_label", "Start date label", "pledge"),
    text("duration_label", "Trial duration label", "pledge"),
    defineField({
      name: "duration_options",
      title: "Trial durations",
      type: "array",
      group: "pledge",
      description: "Empty: 6 months to 5 years",
      of: [
        {
          type: "object",
          fields: [
            defineField({ name: "label", title: "Label", type: "string" }),
            defineField({
              name: "months",
              title: "Months",
              type: "number",
              validation: (Rule) => Rule.required().integer().min(1).max(120),
            }),
          ],
          preview: { select: { title: "label", subtitle: "months" } },
        },
      ],
    }),

    text("contact_heading", "Heading", "contact"),
    text("contact_description", "Description", "contact"),
    text("email_label", "E-mail label", "contact"),

    text("sign_heading", "Heading", "sign"),
    defineField({
      name: "ten_percent_text",
      title: "🔸10% Pledge wording",
      type: "text",
      rows: 5,
      group: "sign",
      description: "{income} and {start_date} are filled in from the form",
    }),
    defineField({
      name: "trial_text",
      title: "🔹Trial Pledge wording",
      type: "text",
      rows: 5,
      group: "sign",
      description: "{income}, {start_date} and {end_date} are filled in from the form",
    }),
    text("motivation_label", "Motivation placeholder", "sign"),
    text("share_motivation_label", "Share motivation label", "sign"),
    text("signed_by_label", "Signed by label", "sign"),
    text("first_name_label", "First name label", "sign"),
    text("last_name_label", "Last name label", "sign"),
    defineField({
      name: "terms_text",
      title: "Terms consent",
      type: "array",
      group: "sign",
      description: "Next to the required checkbox. Link GWWC's terms and privacy policy and ours.",
      of: [BlockTypePresets.linksOnly],
    }),
    text("submit_label", "Submit button", "sign"),

    text("required_message", "Field required", "messages"),
    text("income_invalid_message", "Invalid income %", "messages"),
    text("wealth_invalid_message", "Invalid wealth %", "messages"),
    text("email_invalid_message", "Invalid e-mail", "messages"),
    text("success_heading", "Success heading", "messages"),
    text("success_text", "Success text", "messages"),
    text("failure_text", "Submission failed", "messages"),
  ],
  preview: {
    select: { club: "club_name" },
    prepare: ({ club }) => ({ title: "Pledge signup", subtitle: club }),
  },
});
