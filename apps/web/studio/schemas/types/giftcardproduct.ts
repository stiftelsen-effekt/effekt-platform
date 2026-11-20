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
