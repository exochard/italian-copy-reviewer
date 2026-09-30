import { defineArrayMember, defineField, defineType } from "sanity";

export const glossaryTerm = defineType({
  name: "glossaryTerm",
  title: "Glossary term",
  type: "document",
  fields: [
    defineField({ name: "english", type: "string", validation: (r) => r.required() }),
    defineField({ name: "preferred", title: "Preferred Italian", type: "string", validation: (r) => r.required() }),
    defineField({ name: "avoid", title: "Avoid", type: "array", of: [defineArrayMember({ type: "string" })] }),
    defineField({ name: "note", type: "text", rows: 2 }),
  ],
  preview: { select: { title: "english", subtitle: "preferred" } },
});
