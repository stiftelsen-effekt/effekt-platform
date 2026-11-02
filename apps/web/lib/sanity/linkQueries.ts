// GROQ projections for link lists, in a plain module so server code (App Router) can use them

export const linksSelectorQuery = `
_type == 'navitem' => @ {
  ...,
  "slug": page->slug.current,
  "pagetype": page->_type,
},
_type == 'link' => @ {
  ...
},
`;

export const linksContentQuery = `links[] {
  ${linksSelectorQuery}
}`;
