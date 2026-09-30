import { defineArrayMember, defineField, defineType } from "sanity";

export const l10nRule = defineType({
  name: "l10nRule",
  title: "Localization rule",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string", validation: (r) => r.required() }),
    defineField({ name: "slug", type: "slug", options: { source: "title" }, validation: (r) => r.required() }),
    defineField({
      name: "category", type: "string", validation: (r) => r.required(),
      options: { list: ["calque", "untranslated", "number_format", "capitalization", "agreement",
        "wrong_word_sense", "misspelling", "encoding", "ungrammatical", "consistency"] },
    }),
    defineField({ name: "severity", type: "string", options: { list: ["critical", "major", "minor"] } }),
    defineField({ name: "rule", title: "Rule", type: "text", rows: 4, validation: (r) => r.required() }),
    defineField({ name: "prefer", title: "Preferred forms", type: "array", of: [defineArrayMember({ type: "string" })] }),
    defineField({ name: "avoid", title: "Forms to avoid", type: "array", of: [defineArrayMember({ type: "string" })] }),
    defineField({
      name: "examples", title: "Real shipped examples", type: "array",
      of: [defineArrayMember({
        type: "object", name: "example",
        fields: [
          defineField({ name: "product", type: "string" }),
          defineField({ name: "context", type: "string" }),
          defineField({ name: "englishSource", type: "string" }),
          defineField({ name: "shipped", title: "Shipped Italian", type: "string" }),
          defineField({ name: "fixed", title: "Native correction", type: "string" }),
        ],
        preview: { select: { title: "shipped", subtitle: "fixed" } },
      })],
    }),
  ],
  preview: { select: { title: "title", subtitle: "category" } },
});
