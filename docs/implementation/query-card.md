# Query card: current editorial records on a page

This document records the retained Portable Text `dinkus.query-card` data
contract and the first-class `query_card` page-layout block. Both use
site-owned presentation components; see [the blocks transition](upstream-blocks-transition.md).

## Shop-owner operation

1. In EmDash's collection settings, create an editorial collection such as
   `notices` with drafts enabled. Add string fields `title`, `text`,
   `image` (an image URL), and `link` (a safe destination URL).
2. Add a record from that collection's admin content page, then publish it.
   A draft alone is not public.
3. Open Pages → home. In the native Blocks composition editor, add a Query
   Card block. Set Source to the collection slug and Limit to 1–24, then
   Publish changes. The supported content API and first-class admin card are
   the operational path; the retired slash-command/plugin path is not.
4. Open the public home in a signed-out browser. Each published record has its
   image, title, text, and safe title link. Add and publish another record in
   the collection: reloading the public page updates the list without editing
   or republishing the page.

Public Edit mode does not edit this legacy node inline; edit first-class Query
Card fields in the native Blocks admin card. Legacy Portable Text query cards
remain readable through the local compatibility map, including published-only
records, safe media/link handling, and a bounded newest-first query.

This is editorial composition, not product availability. There are no filters,
pagination, price, stock, or cart controls. Product and collection browse routes
remain template routes. The Home opener library entry is unchanged.

## Proof and initialized starters

`tests/e2e/upstream-blocks.spec.ts` owns the first-class admin insertion,
publication, public query projection, and retained Portable Text fallback
contract. Desktop and mobile public views retain screenshots under the current
ignored run proof root.

The proof restores the original Home composition. It does not add a seed
collection or modify an initialized operator database; no seed migration or
automatic upgrade claim is made. An existing starter owner can use the admin
steps above after adopting the coordinated kit pins.
