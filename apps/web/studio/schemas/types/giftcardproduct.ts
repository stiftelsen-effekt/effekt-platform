import { Gift } from "react-feather";
import { defineArrayMember, defineField, defineType } from "sanity";

/**
 * A gift card product (gavekort): the texts, pictures and self-fill PDF of one product, shared
 * by the purchase block (giftcardwidget), the thank-you block (giftcardthankyou), the overview
 * cards (giftcarditem) and /gavekort/<slug>/gavebevis. The price per unit, the organization and
 * the SMS text are in the API's Giftcard_products, linked by the slug: the slug must be the
 * product's Slug there. Labels for e-mail, tax deduction, newsletter, privacy policy, payment
 * methods and bank details come from a fundraiser widget configuration.
 */
export default defineType({
  title: "Gift card product",
  name: "giftcardproduct",
  type: "document",
  icon: Gift,
  groups: [
    { name: "product", title: "Product", default: true },
    { name: "steps", title: "Steps" },
    { name: "thankyou", title: "After purchase" },
    { name: "recipient", title: "Recipient page" },
  ],
  fields: [
    defineField({
      name: "title",
      title: "Title",
      type: "string",
      group: "product",
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "slug",
      title: "Slug",
      type: "slug",
      group: "product",
      description:
        "Must be the gift card product's slug in the database (Giftcard_products.Slug), e.g. malaria. The certificate is at /gavekort/<slug>/gavebevis.",
      options: { source: "title" },
      validation: (Rule) =>
        Rule.required().custom((value) =>
          value?.current && !/^[a-z0-9-]{1,64}$/.test(value.current)
            ? "Only lower case letters, digits and -"
            : true,
        ),
    }),
    defineField({
      name: "page",
      title: "Page",
      type: "reference",
      group: "product",
      description:
        "The page with this product's gift card block, for links from the gift card overview",
      to: [{ type: "generic_page" }],
    }),
    defineField({
      name: "price_label",
      title: "Price label",
      type: "string",
      group: "product",
      description: 'Shown under the title, e.g. "100 kr per barn"',
    }),
    defineField({
      name: "description",
      title: "Description",
      type: "text",
      rows: 6,
      group: "product",
    }),
    defineField({
      name: "seo_description",
      title: "SEO description",
      type: "string",
      group: "product",
    }),
    defineField({
      name: "images",
      title: "Images",
      type: "array",
      group: "product",
      description: "The first image is the large one",
      of: [
        defineArrayMember({
          type: "image",
          options: { hotspot: true },
          fields: [defineField({ name: "alt", title: "Alternative text", type: "string" })],
        }),
      ],
    }),
    defineField({
      name: "certificate",
      title: "Gift certificate (PDF to fill in)",
      type: "file",
      group: "product",
      description:
        "The self-fill gift certificate. Buyers get a link to it in the receipt (/gavekort/<slug>/gavebevis).",
      options: { accept: "application/pdf" },
    }),
    defineField({
      name: "delivery",
      title: "Delivery options",
      type: "object",
      group: "product",
      fields: [
        defineField({
          name: "question",
          title: "Question",
          type: "string",
          initialValue: "Hvordan vil du gi gavekortet?",
        }),
        defineField({
          name: "allow_sms",
          title: "Offer SMS",
          type: "boolean",
          initialValue: true,
        }),
        defineField({
          name: "sms_label",
          title: "SMS option label",
          type: "string",
          initialValue: "Gavekort på SMS",
        }),
        defineField({
          name: "allow_pdf",
          title: "Offer PDF only",
          type: "boolean",
          initialValue: true,
        }),
        defineField({
          name: "pdf_label",
          title: "PDF option label",
          type: "string",
          initialValue: "Gavebevis til utskrift (PDF)",
        }),
        defineField({
          name: "default_delivery",
          title: "Selected by default",
          type: "string",
          options: { list: ["sms", "pdf"], layout: "radio" },
          initialValue: "sms",
        }),
        defineField({
          name: "start_button_text",
          title: "Start button text",
          type: "string",
          initialValue: "Gi et gavekort",
        }),
      ],
      validation: (Rule) =>
        Rule.custom((value: { allow_sms?: boolean; allow_pdf?: boolean } | undefined) =>
          value && value.allow_sms === false && value.allow_pdf === false
            ? "Offer at least one of SMS and PDF"
            : true,
        ),
    }),
    defineField({
      name: "amount_step",
      title: "Step 1: amount",
      type: "object",
      group: "steps",
      fields: [
        defineField({
          name: "preset_units",
          title: "Preset numbers of units",
          type: "array",
          of: [{ type: "number" }],
          initialValue: [5, 15, 30],
        }),
        defineField({
          name: "preset_label_template",
          title: "Preset button text",
          type: "string",
          description: "{units} is replaced by the number",
          initialValue: "Beskytt {units} barn",
        }),
        defineField({
          name: "units_label",
          title: "Number input label",
          type: "string",
          initialValue: "Hvor mange barn vil du beskytte?",
        }),
        defineField({
          name: "total_label",
          title: "Total label",
          type: "string",
          initialValue: "Totalt",
        }),
      ],
    }),
    defineField({
      name: "message_step",
      title: "Step 2: message",
      type: "object",
      group: "steps",
      fields: [
        defineField({
          name: "heading",
          title: "Heading",
          type: "string",
          initialValue: "Fyll inn feltene som vises i gavekortet",
        }),
        defineField({
          name: "recipient_name_label",
          title: "Recipient name label",
          type: "string",
          initialValue: "Navn på mottaker",
        }),
        defineField({
          name: "message_label",
          title: "Greeting label",
          type: "string",
          initialValue: "En personlig hilsen (valgfritt)",
        }),
        defineField({
          name: "sender_name_label",
          title: "Sender name label",
          type: "string",
          initialValue: "Navn på avsender",
        }),
      ],
    }),
    defineField({
      name: "delivery_step",
      title: "Step 3: SMS delivery",
      type: "object",
      group: "steps",
      fields: [
        defineField({
          name: "phone_label",
          title: "Phone label",
          type: "string",
          initialValue: "Mottakers telefonnummer",
        }),
        defineField({
          name: "phone_help",
          title: "Phone help text",
          type: "string",
          initialValue: "Denne informasjonen brukes kun til å levere gavekortet",
        }),
        defineField({
          name: "when_label",
          title: "When label",
          type: "string",
          initialValue: "Når skal SMS-en leveres?",
        }),
        defineField({
          name: "date_label",
          title: "Date label",
          type: "string",
          initialValue: "Dato",
        }),
        defineField({
          name: "time_label",
          title: "Time label",
          type: "string",
          initialValue: "Klokka",
        }),
      ],
    }),
    defineField({
      name: "summary_step",
      title: "Step 4: summary and payment",
      type: "object",
      group: "steps",
      fields: [
        defineField({
          name: "units_label",
          title: "Units row label",
          type: "string",
          initialValue: "Barn beskyttet mot malaria",
        }),
        defineField({
          name: "price_label",
          title: "Price row label",
          type: "string",
          initialValue: "Pris",
        }),
        defineField({
          name: "send_label",
          title: "Send time row label (SMS)",
          type: "string",
          initialValue: "Sendes",
        }),
        defineField({
          name: "format_label",
          title: "Gift type row label (PDF)",
          type: "string",
          initialValue: "Gavetype",
        }),
        defineField({
          name: "pdf_format_value",
          title: "Gift type value (PDF)",
          type: "string",
          initialValue: "Gavebevis til utskrift",
        }),
        defineField({
          name: "sms_text",
          title: "Text for SMS",
          type: "text",
          rows: 3,
          description: "[dato] and [mottaker] are replaced",
          initialValue: "[dato] sender vi et gavekort på SMS med din melding til [mottaker].",
        }),
        defineField({
          name: "pdf_text",
          title: "Text for PDF",
          type: "text",
          rows: 5,
          initialValue:
            "Når du har betalt, får du en kvittering på e-post med lenke til gavebeviset. Du fyller selv inn hvem gaven er til og fra, og hvor mange barn gaven beskytter.",
        }),
      ],
    }),
    defineField({
      name: "next_button_text",
      title: "Next button text",
      type: "string",
      group: "steps",
      initialValue: "Neste",
    }),
    defineField({
      name: "payment_configuration",
      title: "Payment configuration",
      type: "reference",
      group: "steps",
      description:
        "A fundraiser widget configuration: its e-mail, tax deduction, newsletter, privacy policy, payment method and bank texts are used. Only bank and Vipps are offered.",
      to: [{ type: "fundraiserwidget" }],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: "thank_you_page",
      title: "Thank-you page",
      type: "reference",
      group: "thankyou",
      description:
        'Where buyers land after paying with Vipps: an ordinary page (like /donasjon-mottatt), optionally with a "Gift card purchase details" block. Default /gavekort-mottatt.',
      to: [{ type: "generic_page" }],
    }),
    defineField({
      name: "thank_you",
      title: "Purchase details texts",
      type: "object",
      group: "thankyou",
      description:
        'Shown by the "Gift card purchase details" block, and in the purchase block after a bank purchase',
      fields: [
        defineField({
          name: "sms_text",
          title: "Text for SMS",
          type: "text",
          rows: 3,
          description: "[dato] and [mottaker] are replaced",
          initialValue:
            "[dato] sender vi gavekortet på SMS til [mottaker]. Du får en kvittering på e-post nå, og en ny e-post når SMS-en er sendt. Du trenger ikke gjøre noe mer.",
        }),
        defineField({
          name: "pdf_text",
          title: "Text for PDF",
          type: "text",
          rows: 3,
          initialValue:
            "Du får en kvittering på e-post med lenke til gavebeviset. Du kan også laste det ned her.",
        }),
        defineField({
          name: "pending_text",
          title: "Text while the payment is not received (bank)",
          type: "text",
          rows: 3,
          initialValue:
            "Gavekortet blir sendt når vi har mottatt betalingen. Det tar vanligvis 1–3 virkedager med bankoverføring.",
        }),
        defineField({
          name: "certificate_link_text",
          title: "Certificate link text",
          type: "string",
          initialValue: "Last ned gavebeviset",
        }),
      ],
    }),
    defineField({
      name: "recipient",
      title: "Recipient page (gieffektivt.no/gave/<code>)",
      type: "object",
      group: "recipient",
      description:
        "What the person who gets the gift card sees after opening the link in the SMS. Their name, the giver's name and greeting come from the purchase.",
      fields: [
        defineField({
          name: "impact",
          title: "Impact",
          type: "string",
          description:
            'One sentence, {units} and {unit} are replaced. E.g. "beskytter {units} {unit} mot malaria gjennom en hel sesong"',
          initialValue: "beskytter {units} {unit} mot malaria gjennom en hel sesong",
        }),
        defineField({
          name: "story",
          title: "Story",
          type: "array",
          description:
            "Short chapters the recipient scrolls through, each with an optional picture",
          of: [
            defineArrayMember({
              type: "object",
              name: "chapter",
              fields: [
                defineField({ name: "heading", title: "Heading", type: "string" }),
                defineField({ name: "text", title: "Text", type: "text", rows: 4 }),
                defineField({
                  name: "stat",
                  title: "Big number (optional)",
                  type: "object",
                  fields: [
                    defineField({ name: "value", title: "Value", type: "string" }),
                    defineField({ name: "label", title: "Label", type: "string" }),
                  ],
                }),
                defineField({
                  name: "chart",
                  title: "Bar chart (optional)",
                  type: "object",
                  description:
                    "Bars that grow in when the slide is shown. Highlighted bars are black, the rest outlined.",
                  fields: [
                    defineField({ name: "title", title: "Title", type: "string" }),
                    defineField({
                      name: "bars",
                      title: "Bars",
                      type: "array",
                      of: [
                        defineArrayMember({
                          type: "object",
                          name: "bar",
                          fields: [
                            defineField({ name: "label", title: "Label", type: "string" }),
                            defineField({ name: "value", title: "Value", type: "number" }),
                            defineField({
                              name: "extra",
                              title: "Extra on top (optional)",
                              type: "number",
                              description:
                                "Stacked on the bar, hatched, e.g. the extra deaths had there been no malaria control",
                            }),
                            defineField({
                              name: "highlight",
                              title: "Highlight",
                              type: "boolean",
                            }),
                          ],
                          preview: { select: { title: "label", subtitle: "value" } },
                        }),
                      ],
                    }),
                    defineField({
                      name: "highlight_label",
                      title: "Legend for highlighted bars",
                      type: "string",
                    }),
                    defineField({
                      name: "extra_label",
                      title: "Legend for the extra on top",
                      type: "string",
                    }),
                    defineField({
                      name: "axis",
                      title: "Show a y-axis",
                      type: "boolean",
                      description: 'A few round values left of the chart, e.g. "1 mill"',
                    }),
                    defineField({
                      name: "axis",
                      title: "Show a y-axis",
                      type: "boolean",
                      description: 'A few round values left of the chart, e.g. "1 mill"',
                    }),
                    defineField({
                      name: "callouts",
                      title: "Big numbers beside the chart",
                      type: "array",
                      of: [
                        defineArrayMember({
                          type: "object",
                          name: "callout",
                          fields: [
                            defineField({ name: "value", title: "Value", type: "string" }),
                            defineField({ name: "label", title: "Label", type: "string" }),
                          ],
                        }),
                      ],
                    }),
                    defineField({ name: "caption", title: "Caption / source", type: "string" }),
                  ],
                }),
                defineField({
                  name: "waffle",
                  title: "Square chart (optional)",
                  type: "object",
                  description:
                    '100 filled squares, of which the given share empties out when the slide is shown. E.g. 75 for "three in four malaria cases prevented".',
                  fields: [
                    defineField({
                      name: "share",
                      title: "Share that empties out (%)",
                      type: "number",
                      validation: (Rule) => Rule.min(0).max(100),
                    }),
                    defineField({ name: "filled_label", title: "Legend, filled", type: "string" }),
                    defineField({ name: "empty_label", title: "Legend, emptied", type: "string" }),
                    defineField({ name: "caption", title: "Caption / source", type: "string" }),
                  ],
                }),
                defineField({
                  name: "map",
                  title: "Map (optional)",
                  type: "object",
                  description: "The Africa map, with these countries lighting up one by one",
                  fields: [
                    defineField({
                      name: "countries",
                      title: "Countries",
                      type: "array",
                      of: [{ type: "string" }],
                      description: "Two-letter country codes, e.g. ng, bf, td, tg, mz",
                    }),
                    defineField({ name: "caption", title: "Caption / source", type: "string" }),
                  ],
                }),
                defineField({
                  name: "image",
                  title: "Picture",
                  type: "image",
                  options: { hotspot: true },
                  fields: [defineField({ name: "alt", title: "Alternative text", type: "string" })],
                }),
              ],
              preview: { select: { title: "heading", media: "image" } },
            }),
          ],
        }),
        defineField({
          name: "organization",
          title: "Organization",
          type: "reference",
          to: [{ type: "organization" }],
          description: "Who does the work: its name, summary and page are shown near the end",
        }),
        defineField({
          name: "organization_logo",
          title: "Organization logo (colour)",
          type: "image",
          description:
            "Shown instead of the organization's black and white logo on this page. Get the organization's permission first.",
        }),
        defineField({
          name: "cta_heading",
          title: "Closing heading",
          type: "string",
          initialValue: "Vil du gjøre enda mer?",
        }),
        defineField({
          name: "cta_text",
          title: "Closing text",
          type: "text",
          rows: 3,
          initialValue:
            "Med en fast månedlig donasjon beskytter du nye barn hver sesong. Du bestemmer selv beløpet, og kan endre eller stoppe når som helst.",
        }),
        defineField({
          name: "recurring_label",
          title: "Monthly donation button",
          type: "string",
          description: "Opens the donation widget with a monthly donation to the organization",
          initialValue: "Sett opp fast donasjon",
        }),
        defineField({
          name: "organization_label",
          title: "Organization button",
          type: "string",
          description: "Links to the organization's page",
          initialValue: "Les mer om organisasjonen",
        }),
      ],
    }),
  ],
  preview: {
    select: { title: "title", slug: "slug.current", media: "images.0" },
    prepare: ({ title, slug, media }) => ({
      title,
      subtitle: slug ? `Product ${slug}` : undefined,
      media,
    }),
  },
});
