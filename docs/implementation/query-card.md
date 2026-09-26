# Query card: current editorial records on a page

This document records the existing Portable Text `dinkus.query-card` plugin
integration. The first-class `query_card` page-layout block is a separate
site-owned renderer; see [the blocks transition](upstream-blocks-transition.md).
Both remain supported during migration.

## Shop-owner operation

1. In EmDash's collection settings, create an editorial collection such as
   `notices` with drafts enabled. Add string fields `title`, `text`,
   `image` (an image URL), and `link` (a safe destination URL).
2. Add a record from that collection's admin content page, then publish it.
   A draft alone is not public.
3. Open Pages → home. In the composition editor type `/query` and choose
   Query Card. Set Source to the collection slug and Limit to 1–24. Insert,
   then Publish changes.
4. Open the public home in a signed-out browser. Each published record has its
   image, title, text, and safe title link. Add and publish another record in
   the collection: reloading the public page updates the list without editing
   or republishing the page.

Public Edit mode on EmDash 0.41.0 uses the plugin-block placeholder; edit the
Query Card fields in admin. It is not an inline block editor.

This is editorial composition, not product availability. There are no filters,
pagination, price, stock, or cart controls. Product and collection browse routes
remain template routes. The Home opener library entry is unchanged.

## Proof and initialized starters

`tests/e2e/query-card.spec.ts` owns this integration contract. The full web
verifier creates a disposable editorial collection via authenticated EmDash
schema APIs, drives the actual admin slash insertion and publication, and uses
a separate anonymous browser for public before/after assertions. It also checks
the admin records and authenticated public Edit surface. Desktop and mobile
public views retain screenshots under `runs/query-card-20260926/browser/`.

The proof restores the original Home composition. It does not add a seed
collection or modify an initialized operator database; no seed migration or
automatic upgrade claim is made. An existing starter owner can use the admin
steps above after adopting the coordinated kit pins.
