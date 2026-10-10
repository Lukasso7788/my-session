import type { SeoPageDefinition } from "../data/seoPageRegistry";

const SITE_ORIGIN = "https://mysession.club";

export function buildSeoPageStructuredData(page: SeoPageDefinition) {
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: page.h1, item: page.canonicalUrl },
    ],
  };
  const primary = page.pageType === "topic-hub"
    ? {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: page.h1,
        description: page.metaDescription,
        url: page.canonicalUrl,
        ...(page.imagePath ? { primaryImageOfPage: `${SITE_ORIGIN}${page.imagePath}` } : {}),
        hasPart: [{ "@type": "Article", name: "What is body doubling?", url: `${SITE_ORIGIN}/guides/what-is-body-doubling` }],
      }
    : page.pageType === "guide"
    ? {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: page.h1,
        description: page.metaDescription,
        datePublished: page.createdAt,
        dateModified: page.updatedAt,
        mainEntityOfPage: page.canonicalUrl,
        ...(page.imagePath ? { image: `${SITE_ORIGIN}${page.imagePath}` } : {}),
        author: { "@type": "Organization", name: "MySession" },
        publisher: { "@type": "Organization", name: "MySession", url: SITE_ORIGIN },
      }
    : page.slug === "body-doubling-app"
      ? {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "MySession",
          applicationCategory: "ProductivityApplication",
          operatingSystem: "Web",
          url: SITE_ORIGIN,
          description: page.metaDescription,
          ...(page.imagePath ? { image: `${SITE_ORIGIN}${page.imagePath}` } : {}),
        }
      : {
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: page.h1,
          url: page.canonicalUrl,
          description: page.metaDescription,
          ...(page.imagePath ? { primaryImageOfPage: `${SITE_ORIGIN}${page.imagePath}` } : {}),
        };
  const faq = page.faqItems.length > 0
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: page.faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }
    : null;
  return [breadcrumb, primary, faq].filter(Boolean);
}
