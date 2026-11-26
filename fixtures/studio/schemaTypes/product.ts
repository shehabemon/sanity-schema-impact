import { defineArrayMember, defineField, defineType } from 'sanity';

export const product = defineType({
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string' }),
    defineField({
      name: 'variants',
      title: 'Variants',
      type: 'array',
      of: [
        defineArrayMember({
          type: 'object',
          name: 'variant',
          fields: [
            defineField({ name: 'sku', title: 'SKU', type: 'string' }),
            defineField({
              name: 'price',
              title: 'Price',
              type: 'object',
              fields: [
                defineField({ name: 'amount', title: 'Amount', type: 'number' }),
                defineField({ name: 'currency', title: 'Currency', type: 'string' }),
              ],
            }),
          ],
        }),
      ],
    }),
    defineField({
      name: 'tags',
      title: 'Tags',
      type: 'array',
      of: [defineArrayMember({ type: 'string' })],
    }),
    defineField({
      name: 'relatedPosts',
      title: 'Related posts',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'post' }] })],
    }),
    defineField({
      name: 'legacySku',
      title: 'Legacy SKU',
      type: 'string',
      description: 'DEPRECATED: use variants[].sku instead. Kept for old integrations.',
    }),
  ],
});
