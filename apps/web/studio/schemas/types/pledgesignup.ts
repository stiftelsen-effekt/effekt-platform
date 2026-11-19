import { defineField, defineType } from "sanity";

export default defineType({
  name: "pledgesignup",
  title: "PledgeSignUp",
  type: "object",
  fields: [
    defineField({
      name: "title",
      title: "Internal label",
      type: "string",
      description: "Only used in Sanity, not displayed on the website.",
    }),
  ],
  preview: {
    prepare: () => ({ title: "PledgeSignUp" }),
  },
});
