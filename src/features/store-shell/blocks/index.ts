import CollapsibleSection from "./CollapsibleSection.astro";
import HomeOpener from "./HomeOpener.astro";
import QueryCard from "./QueryCard.astro";
import RichText from "./RichText.astro";
import SpecTable from "./SpecTable.astro";

export const pageLayoutComponents = {
  home_opener: HomeOpener,
  rich_text: RichText,
  query_card: QueryCard,
};

/** Sections under a product's buy box (template-rich-product-page-20261027). */
export const productDetailComponents = {
  collapsible_section: CollapsibleSection,
  spec_table: SpecTable,
  rich_text: RichText,
};
