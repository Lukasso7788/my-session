import rawPages from "./seo-pages.json";

export type SeoPageType = "guide" | "use-case" | "comparison" | "session-format";
export type SeoSearchIntent = "informational" | "commercial" | "informational-commercial" | "commercial-comparison";
export type SeoChangeFrequency = "weekly" | "monthly" | "yearly";

export type SeoSectionDefinition = {
  heading: string;
  body: string[];
  bullets?: string[];
};

export type SeoFaqItem = { question: string; answer: string };

export type SeoPageDefinition = {
  slug: string;
  route: string;
  canonicalUrl: string;
  pageType: SeoPageType;
  cluster: "body-doubling" | "virtual-coworking" | "comparisons" | "focus-formats";
  title: string;
  metaDescription: string;
  h1: string;
  heroDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: SeoSearchIntent;
  sections: SeoSectionDefinition[];
  faqItems: SeoFaqItem[];
  relatedPageSlugs: string[];
  ctaVariant: "join" | "try" | "start" | "explore" | "compare";
  indexable: boolean;
  sitemapPriority: number;
  changeFrequency: SeoChangeFrequency;
  createdAt: string;
  updatedAt: string;
};

type RawSeoPageDefinition = Omit<SeoPageDefinition, "canonicalUrl">;

export const seoPages: SeoPageDefinition[] = (rawPages as RawSeoPageDefinition[]).map((page) => ({
  ...page,
  canonicalUrl: `https://mysession.club${page.route}`,
}));
export const seoPagesBySlug = new Map(seoPages.map((page) => [page.slug, page]));

export function getRelatedSeoPages(page: SeoPageDefinition) {
  const explicit = page.relatedPageSlugs
    .map((slug) => seoPagesBySlug.get(slug))
    .filter((item): item is SeoPageDefinition => Boolean(item));
  const sameCluster = seoPages.filter(
    (candidate) => candidate.slug !== page.slug && candidate.cluster === page.cluster,
  );
  return [...new Map([...explicit, ...sameCluster].map((item) => [item.slug, item])).values()].slice(0, 4);
}
