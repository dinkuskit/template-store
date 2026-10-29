import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getSuggestions, searchWithDb } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { applySeed, validateSeed } from "emdash/seed";
import { Kysely, sql } from "kysely";
import { describe, expect, it } from "vitest";
import {
  evaluatePublicBoundary,
  slashlessRedirectPath,
} from "../../src/features/security/public-boundary.js";
import {
  FOOTER_POLICIES_MENU_NAME,
  FOOTER_SHOP_MENU_NAME,
  POLICY_SUPPORT_SECTION_SLUG,
  STORE_PRESETS,
  STORE_THEMES,
  ensureStorefrontSearchSupport,
  filterPublicSearchApiResponse,
  filterStorefrontSearchHits,
  isSearchProductVisibleOnStorefront,
  isStorePresetName,
  isStoreThemeMode,
  renderHighlightedSnippetParts,
} from "../../src/features/store-shell/index.js";

const PUBLIC_STOREFRONT_PAGES = [
  "src/pages/index.astro",
  "src/pages/categories/[slug].astro",
  "src/pages/products/[id].astro",
  "src/pages/cart.astro",
  "src/pages/checkout/index.astro",
  "src/pages/account.astro",
  "src/pages/checkout/success.astro",
  "src/pages/shipping.astro",
  "src/pages/returns.astro",
  "src/pages/search.astro",
] as const;

describe("Upstream EmDash theming (tokens.css + theme.css) & multi-preset support", () => {
  it("defines @layer base tokens with light-dark() and 3 curated Stitch presets in src/styles/tokens.css", () => {
    const tokensCss = readFileSync(resolve("src/styles/tokens.css"), "utf8");
    expect(tokensCss).toMatch(/^@layer base\s*\{/mu);
    expect(tokensCss).toContain("light-dark(");
    expect(tokensCss).toContain(':root[data-preset="aizome"]');
    expect(tokensCss).toContain(':root[data-preset="forest"]');
    expect(tokensCss).toContain(':root[data-preset="cobalt"]');
    expect(tokensCss).toContain(':root[data-theme="light"]');
    expect(tokensCss).toContain(':root[data-theme="dark"]');
    expect(tokensCss).toContain(':root[data-theme="system"]');
  });

  it("ships an unlayered adopter override sheet in src/styles/theme.css imported after tokens.css", () => {
    const themeCss = readFileSync(resolve("src/styles/theme.css"), "utf8");
    const uncommented = themeCss.replace(/\/\*[\s\S]*?\*\//gu, "");
    expect(uncommented).not.toContain("@layer");
    expect(uncommented).toMatch(/:root\s*\{\s*\}/mu);

    const globalCss = readFileSync(resolve("src/features/store-shell/global.css"), "utf8");
    const tokensImportIndex = globalCss.indexOf('@import "../../styles/tokens.css";');
    const themeImportIndex = globalCss.indexOf('@import "../../styles/theme.css";');
    expect(tokensImportIndex).toBeGreaterThanOrEqual(0);
    expect(themeImportIndex).toBeGreaterThan(tokensImportIndex);
  });

  it("validates theme modes and Stitch preset names", () => {
    for (const mode of STORE_THEMES) {
      expect(isStoreThemeMode(mode)).toBe(true);
    }
    expect(isStoreThemeMode("sepia")).toBe(false);

    for (const preset of STORE_PRESETS) {
      expect(isStorePresetName(preset)).toBe(true);
    }
    expect(isStorePresetName("neon")).toBe(false);
  });
});

describe("Shared StoreFooter.astro & public route mounting", () => {
  it("mounts StoreFooter across every public storefront route", () => {
    for (const pagePath of PUBLIC_STOREFRONT_PAGES) {
      const source = readFileSync(resolve(pagePath), "utf8");
      expect(source, pagePath).toContain("StoreFooter.astro");
      expect(source, pagePath).toContain("<StoreFooter profile={profile} />");
    }
  });

  it("wires getSiteSettingsWithCacheHint, footer menus, WidgetArea, and theme/preset switchers in StoreFooter.astro", () => {
    const footer = readFileSync(resolve("src/features/store-shell/StoreFooter.astro"), "utf8");
    expect(footer).toContain("getSiteSettingsWithCacheHint");
    expect(footer).toContain("Astro.cache.set(footerAreaResult.cacheHint)");
    expect(footer).toContain('<WidgetArea name="footer" />');
    expect(footer).toContain("data-footer-shop-nav");
    expect(footer).toContain("data-footer-policies-nav");
    expect(footer).toContain("data-nav-source=");
    expect(footer).toContain("data-theme-switcher");
    expect(footer).toContain("data-preset-switcher");
    expect(footer).toContain("Transactional facts remain in Commerce");
    // Preserve intentionally empty CMS menus without falling back to hardcoded categories:
    expect(footer).toContain("const hasCmsShopMenu = shopMenuData !== null;");
    expect(footer).toContain("const hasCmsPoliciesMenu = policiesMenuData !== null;");
    expect(footer).not.toContain("shopMenuResult?.data?.items?.length");
    expect(footer).not.toContain("policiesMenuResult?.data?.items?.length");

    // Never hide merchant-configured footer menu widgets via CSS:
    const globalCss = readFileSync(resolve("src/features/store-shell/global.css"), "utf8");
    expect(globalCss).not.toMatch(/data-widget-type=["']menu["']\)\s*\{\s*display:\s*none/u);
  });
});

describe("EmDash composition primitives & seed contract", () => {
  it("passes validateSeed() with zero errors and zero warnings", () => {
    const seed = JSON.parse(readFileSync(resolve("seed/seed.json"), "utf8"));
    const validation = validateSeed(seed);
    expect(validation).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it("exercises blocks, sections, widgetAreas (all 3 widget types), menus, and FTS5 search in a seeded database", async () => {
    const db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    try {
      await runMigrations(db as never);
      const seed = JSON.parse(readFileSync(resolve("seed/seed.json"), "utf8"));
      await applySeed(db as never, seed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });

      // 1. Menus: footer_shop, footer_policies & footer_account
      const menus = (
        await sql<{ name: string }>`select name from _emdash_menus order by name`.execute(db)
      ).rows.map((r) => r.name);
      expect(menus).toContain(FOOTER_SHOP_MENU_NAME);
      expect(menus).toContain(FOOTER_POLICIES_MENU_NAME);
      expect(menus).toContain("footer_account");

      const policiesLinks = (
        await sql<{ label: string; custom_url: string }>`
          select mi.label, mi.custom_url
          from _emdash_menu_items mi
          join _emdash_menus m on m.id = mi.menu_id
          where m.name = ${FOOTER_POLICIES_MENU_NAME}
          order by mi.sort_order asc
        `.execute(db)
      ).rows;
      expect(policiesLinks.map((item) => item.custom_url)).toEqual([
        "/shipping",
        "/returns",
      ]);

      // 2. WidgetArea: "footer" with content, menu, and component (core:search) widgets
      const widgets = (
        await sql<{
          type: string;
          menu_name: string | null;
          component_id: string | null;
          component_props: string | null;
        }>`
          select w.type, w.menu_name, w.component_id, w.component_props
          from _emdash_widgets w
          join _emdash_widget_areas wa on wa.id = w.area_id
          where wa.name = 'footer'
          order by w.sort_order asc
        `.execute(db)
      ).rows;
      expect(widgets.map((w) => w.type)).toEqual(["content", "menu", "component"]);
      // The menu widget lists different links from the fixed "Policies & Care" column.
      expect(widgets[1]?.menu_name).toBe("footer_account");
      expect(widgets[2]?.component_id).toBe("core:search");
      expect(JSON.parse(widgets[2]?.component_props ?? "{}")).toEqual({
        placeholder: "Search products...",
      });

      // 3. Sections: legacy home-opener + reusable policy-support-note
      const sections = (
        await sql<{ slug: string; title: string; content: string }>`
          select slug, title, content from _emdash_sections order by slug asc
        `.execute(db)
      ).rows;
      expect(sections.map((s) => s.slug)).toEqual(["home-opener", POLICY_SUPPORT_SECTION_SLUG]);
      const policySupport = sections.find((s) => s.slug === POLICY_SUPPORT_SECTION_SLUG);
      expect(policySupport?.title).toBe("Policy and care note");
      expect(policySupport?.content).not.toMatch(/\$\d|\b[A-Z]{2}\b|\d+ days/u);

      // 4. FTS5 Search across products, categories, and pages
      const teeResults = await searchWithDb(db as never, "Everyday Tee", {
        collections: ["products", "categories", "pages"],
      });
      expect(
        teeResults.items.some((hit) => hit.collection === "products" && hit.slug === "everyday-tee"),
      ).toBe(true);

      const shippingResults = await searchWithDb(db as never, "Shipping", {
        collections: ["products", "categories", "pages"],
      });
      expect(
        shippingResults.items.some((hit) => hit.collection === "pages" && hit.slug === "shipping"),
      ).toBe(true);

      // 5. Unpublished (draft) content stays outside default/anonymous search and suggestions
      await sql`
        insert into ec_products (id, slug, status, title, description, visual_label, created_at, updated_at)
        values ('draft-secret-parka', 'draft-secret-parka', 'draft', 'Secret Prototype Parka', 'Unpublished draft item', 'hoodie', datetime('now'), datetime('now'))
      `.execute(db);
      await sql`
        insert into ec_pages (id, slug, status, title, created_at, updated_at)
        values ('draft-secret-policy', 'draft-secret-policy', 'draft', 'Secret Prototype Policy', datetime('now'), datetime('now'))
      `.execute(db);

      const draftSearch = await searchWithDb(db as never, "Secret Prototype", {
        collections: ["products", "categories", "pages"],
      });
      expect(draftSearch.items).toEqual([]);

      const draftSuggestions = await getSuggestions(db as never, "Secret", {
        collections: ["products", "categories", "pages"],
      });
      expect(draftSuggestions).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  it("upgrades existing stores initialized from older seeds to FTS5 search without overwriting merchant edits", async () => {
    const db = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
    try {
      await runMigrations(db as never);
      const legacySeed = JSON.parse(
        readFileSync(resolve("tests/fixtures/seed-before-product-categories.json"), "utf8"),
      );
      await applySeed(db as never, legacySeed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });
      await sql`update ec_categories set title = 'Caps & Hats' where slug = 'hats'`.execute(db);

      const currentSeed = JSON.parse(readFileSync(resolve("seed/seed.json"), "utf8"));
      await applySeed(db as never, currentSeed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });
      await ensureStorefrontSearchSupport(db);

      const categoryLabel = (
        await sql<{ label: string }>`select label from _emdash_collections where slug = 'categories'`.execute(db)
      ).rows[0]?.label;
      expect(categoryLabel).toBe("Categories");

      const capsHit = await searchWithDb(db as never, "Caps", {
        collections: ["products", "categories", "pages"],
      });
      expect(
        capsHit.items.some((hit) => hit.collection === "categories" && hit.slug === "hats"),
      ).toBe(true);

      // If a merchant disables search on `products.description` (`searchable = 0`)
      // and rebuilds the FTS index, re-running `ensureStorefrontSearchSupport`
      // must preserve `searchable = 0` rather than re-enabling it.
      await sql`
        update _emdash_fields
        set searchable = 0
        where slug = 'description'
          and collection_id = (select id from _emdash_collections where slug = 'products')
      `.execute(db);
      const { FTSManager } = await import("emdash");
      const fts = new FTSManager(db as never);
      await fts.enableSearch("products");

      await ensureStorefrontSearchSupport(db);

      const descriptionSearchable = Number(
        (
          await sql<{ searchable: number }>`
            select coalesce(searchable, 0) as searchable
            from _emdash_fields
            where slug = 'description'
              and collection_id = (select id from _emdash_collections where slug = 'products')
          `.execute(db)
        ).rows[0]?.searchable ?? -1,
      );
      expect(descriptionSearchable).toBe(0);
    } finally {
      await db.destroy();
    }
  });

  it("upgrades an on-disk non-demo SQLite store through scripts/upgrade-storefront-search.ts and preserves merchant field exclusions across repeated runs", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dinkus-search-upgrade-"));
    const dbPath = join(tempDir, "content.db");
    const setupDb = new Kysely<never>({ dialect: createDialect({ url: dbPath }) });
    try {
      await runMigrations(setupDb as never);
      const legacySeed = JSON.parse(
        readFileSync(resolve("tests/fixtures/seed-before-product-categories.json"), "utf8"),
      );
      await applySeed(setupDb as never, legacySeed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });
      await sql`update ec_categories set title = 'Caps & Hats' where slug = 'hats'`.execute(
        setupDb,
      );
      const currentSeed = JSON.parse(readFileSync(resolve("seed/seed.json"), "utf8"));
      await applySeed(setupDb as never, currentSeed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });
    } finally {
      await setupDb.destroy();
    }

    try {
      const firstRunOutput = execFileSync(
        process.execPath,
        [resolve("scripts/upgrade-storefront-search.ts"), `--database=${dbPath}`],
        { encoding: "utf8" },
      ).trim();
      const firstReceipt = JSON.parse(firstRunOutput) as {
        action: string;
        database: string;
        collections: string[];
      };
      expect(firstReceipt.action).toBe("search-upgrade");
      expect(firstReceipt.collections).toEqual(["pages", "products", "categories"]);

      const verifyDb = new Kysely<never>({ dialect: createDialect({ url: dbPath }) });
      try {
        const capsHit = await searchWithDb(verifyDb as never, "Caps", {
          collections: ["products", "categories", "pages"],
        });
        expect(
          capsHit.items.some((hit) => hit.collection === "categories" && hit.slug === "hats"),
        ).toBe(true);

        // Disable search on `products.description` (`searchable = 0`) and rebuild FTS.
        await sql`
          update _emdash_fields
          set searchable = 0
          where slug = 'description'
            and collection_id = (select id from _emdash_collections where slug = 'products')
        `.execute(verifyDb);
        const { FTSManager } = await import("emdash");
        const fts = new FTSManager(verifyDb as never);
        await fts.enableSearch("products");
      } finally {
        await verifyDb.destroy();
      }

      // Re-run the non-demo CLI entrypoint; merchant `searchable = 0` exclusion must survive.
      const secondRunOutput = execFileSync(
        process.execPath,
        [resolve("scripts/upgrade-storefront-search.ts"), `--database=${dbPath}`],
        { encoding: "utf8" },
      ).trim();
      expect(JSON.parse(secondRunOutput).action).toBe("search-upgrade");

      const postDb = new Kysely<never>({ dialect: createDialect({ url: dbPath }) });
      try {
        const descriptionSearchable = Number(
          (
            await sql<{ searchable: number }>`
              select coalesce(searchable, 0) as searchable
              from _emdash_fields
              where slug = 'description'
                and collection_id = (select id from _emdash_collections where slug = 'products')
            `.execute(postDb)
          ).rows[0]?.searchable ?? -1,
        );
        expect(descriptionSearchable).toBe(0);
      } finally {
        await postDb.destroy();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // template-sells-anything-20261027: the advertised command alone, with no re-seed.
  it("upgrades an older store's product schema through scripts/upgrade-storefront-search.ts with no re-seed", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dinkus-schema-upgrade-"));
    const dbPath = join(tempDir, "content.db");
    const open = () => new Kysely<never>({ dialect: createDialect({ url: dbPath }) });
    const products = (db: Kysely<never>, columns: string) =>
      sql.raw<Record<string, unknown>>(`select ${columns} from ec_products order by id`).execute(db);
    let columns = "";
    let before: Record<string, unknown>[] = [];
    const setupDb = open();
    try {
      await runMigrations(setupDb as never);
      const legacySeed = JSON.parse(
        readFileSync(resolve("tests/fixtures/seed-before-product-categories.json"), "utf8"),
      );
      await applySeed(setupDb as never, legacySeed, {
        includeContent: true,
        onConflict: "skip",
        skipMediaDownload: true,
      });
      await sql`update ec_products set description = 'Owner wording' where slug = 'everyday-tee'`.execute(setupDb);
      // Step 005 takes the Commerce product box off (template-no-commerce-box-20261029): the seed's demonstration
      // ids name no Commerce product, so no page needs it. Every other saved value stays.
      columns = (await sql<{ name: string }>`select name from pragma_table_info('ec_products')`.execute(setupDb)).rows
        .filter((row) => row.name !== "commerce_item_id")
        .map((row) => `"${row.name}"`)
        .join(", ");
      before = (await products(setupDb, columns)).rows;
    } finally {
      await setupDb.destroy();
    }

    try {
      execFileSync(process.execPath, [resolve("scripts/upgrade-storefront-search.ts"), `--database=${dbPath}`], {
        encoding: "utf8",
      });
      const verifyDb = open();
      try {
        expect((await products(verifyDb, columns)).rows).toEqual(before);
        const fields = (await sql<{ slug: string; required: number }>`
          select f.slug, f.required from _emdash_fields f join _emdash_collections c on c.id = f.collection_id
          where c.slug = 'products'`.execute(verifyDb)).rows;
        expect(fields.find((field) => field.slug === "visual_label")?.required).toBe(0);
        expect(fields.map((field) => field.slug)).toEqual(expect.arrayContaining(["summary", "details"]));
        expect(fields.map((field) => field.slug)).not.toContain("commerce_item_id");
        const blockTypes = (await sql<{ slug: string }>`
          select t.slug from _emdash_block_types t join _emdash_block_type_versions v on v.block_type_id = t.id and v.version = t.current_version
          order by t.slug`.execute(verifyDb)).rows.map((row) => row.slug);
        expect(blockTypes).toEqual(expect.arrayContaining(["collapsible_section", "rich_text", "spec_table"]));
        const hit = await searchWithDb(verifyDb as never, "Owner wording", { collections: ["products"] });
        expect(hit.items.some((item) => item.slug === "everyday-tee")).toBe(true);
        // The new summary joins the same index.
        await sql`update ec_products set summary = ${JSON.stringify([{ _type: "block", _key: "s", style: "normal", children: [{ _type: "span", _key: "t", text: "Heavyweight loopback", marks: [] }], markDefs: [] }])} where slug = 'everyday-tee'`.execute(verifyDb);
        expect((await searchWithDb(verifyDb as never, "loopback", { collections: ["products"] })).items.map((item) => item.slug)).toEqual(["everyday-tee"]);
      } finally {
        await verifyDb.destroy();
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("escapes FTS5 snippet HTML and strips untrusted tags instead of using set:html on /search", () => {
    const searchPage = readFileSync(resolve("src/pages/search.astro"), "utf8");
    expect(searchPage).not.toContain("set:html");

    const parts = renderHighlightedSnippetParts(
      'Soft <mark>cotton</mark> <img src=x onerror=alert(1)> &amp; heavyweight <script>evil()</script><mark>fleece</mark>',
    );
    expect(parts).toEqual([
      { text: "Soft ", highlighted: false },
      { text: "cotton", highlighted: true },
      { text: "  & heavyweight evil()", highlighted: false },
      { text: "fleece", highlighted: true },
    ]);
  });

  it("filters product search hits through storefront visibility rules (archived Commerce items and suppressed demos)", () => {
    const activeIds = new Set(["cat_live_tee"]);
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "live-tee", slug: "live-tee", commerceItemId: "cat_live_tee" },
        {
          profile: "shipping",
          catalogAvailable: true,
          activeCommerceIds: activeIds,
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(true);

    // Archived Commerce product (`cat_archived_hoodie` not in activeIds) is excluded:
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "archived-hoodie", slug: "archived-hoodie", commerceItemId: "cat_archived_hoodie" },
        {
          profile: "shipping",
          catalogAvailable: true,
          activeCommerceIds: activeIds,
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(false);

    // Editorial preview (`dinkus-template-preview-*`) remains visible:
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "boxy-tee-preview", slug: "boxy-tee-preview", commerceItemId: "dinkus-template-preview-boxy-tee" },
        {
          profile: "shipping",
          catalogAvailable: true,
          activeCommerceIds: activeIds,
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(true);

    // Proof demonstration products are hidden on shipping profile when not in Commerce catalog:
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "everyday-tee", slug: "everyday-tee", commerceItemId: "dinkus-template-managed-product" },
        {
          profile: "shipping",
          catalogAvailable: true,
          activeCommerceIds: activeIds,
          managedListable: true,
          unmanagedListable: true,
        },
      ),
    ).toBe(false);

    // When Commerce catalog read fails on shipping profile, Commerce-linked items fail closed
    // (even if activeCommerceIds were stale/non-empty), while editorial previews stay visible:
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "archived-hoodie", slug: "archived-hoodie", commerceItemId: "cat_archived_hoodie" },
        {
          profile: "shipping",
          catalogAvailable: false,
          activeCommerceIds: new Set(),
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(false);
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "live-tee", slug: "live-tee", commerceItemId: "cat_live_tee" },
        {
          profile: "shipping",
          catalogAvailable: false,
          activeCommerceIds: activeIds,
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(false);
    expect(
      isSearchProductVisibleOnStorefront(
        { id: "boxy-tee-preview", slug: "boxy-tee-preview", commerceItemId: "dinkus-template-preview-boxy-tee" },
        {
          profile: "shipping",
          catalogAvailable: false,
          activeCommerceIds: new Set(),
          managedListable: false,
          unmanagedListable: false,
        },
      ),
    ).toBe(true);

    const visibleSlugs = new Set(["live-tee", "boxy-tee-preview"]);
    const rawHits = [
      { collection: "products", id: "live-tee", slug: "live-tee" },
      { collection: "products", id: "archived-hoodie", slug: "archived-hoodie" },
      { collection: "pages", id: "shipping", slug: "shipping" },
      { collection: "categories", id: "tees", slug: "tees" },
      { collection: "merchandise", id: "legacy-item", slug: "legacy-item" },
    ];
    expect(filterStorefrontSearchHits(rawHits, visibleSlugs)).toEqual([
      { collection: "products", id: "live-tee", slug: "live-tee" },
      { collection: "pages", id: "shipping", slug: "shipping" },
      { collection: "categories", id: "tees", slug: "tees" },
    ]);
  });

  it("suppresses product hits on public search API responses when visibility resolution rejects", async () => {
    const upstream = Response.json({
      success: true,
      data: {
        items: [
          { collection: "products", id: "live-tee", slug: "live-tee" },
          { collection: "products", id: "archived-hoodie", slug: "archived-hoodie" },
          { collection: "pages", id: "shipping", slug: "shipping" },
          { collection: "categories", id: "tees", slug: "tees" },
        ],
        total: 4,
      },
    });
    const filtered = await filterPublicSearchApiResponse(
      upstream,
      { runtime: null, request: new Request("http://127.0.0.1:4638/_emdash/api/search?q=tee") },
      async () => {
        throw new Error("visibility lookup failed");
      },
    );
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toEqual({
      success: true,
      data: {
        items: [
          { collection: "pages", id: "shipping", slug: "shipping" },
          { collection: "categories", id: "tees", slug: "tees" },
        ],
        total: 2,
      },
    });
  });

  it("allows /search and EmDash public search API endpoints through the public boundary while rejecting non-storefront collections or draft status", () => {
    const middlewareSource = readFileSync(resolve("src/middleware.ts"), "utf8");
    expect(middlewareSource).not.toContain("ensureStorefrontSearchSupport");

    expect(evaluatePublicBoundary("GET", "/search", "?q=tee")).toEqual({
      allowed: true,
      status: 200,
    });
    expect(evaluatePublicBoundary("GET", "/_emdash/api/search", "?q=tee&collections=products")).toEqual({
      allowed: true,
      status: 200,
    });
    expect(evaluatePublicBoundary("GET", "/_emdash/api/search/suggest", "?q=te")).toEqual({
      allowed: true,
      status: 200,
    });
    expect(evaluatePublicBoundary("GET", "/_emdash/api/search", "?q=tee&collections=merchandise")).toEqual({
      allowed: false,
      status: 403,
      reason: "Public search only serves storefront collections (products, categories, pages).",
    });
    expect(evaluatePublicBoundary("GET", "/_emdash/api/search", "?q=tee&status=draft")).toEqual({
      allowed: false,
      status: 403,
      reason: "Public search only serves published storefront content.",
    });
    expect(slashlessRedirectPath("/search/")).toBe("/search");
  });
});
