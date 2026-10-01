import FactRail from "./FactRail.astro";
import PageHero from "./PageHero.astro";
import QueryCard from "./QueryCard.astro";
import UnknownContent from "./UnknownContent.astro";

export const legacyPortableTextComponents = {
  type: {
    "dinkus.page-hero": PageHero,
    "dinkus.fact-rail": FactRail,
    "dinkus.query-card": QueryCard,
  },
  unknownType: UnknownContent,
};
