type ArticleSeo = {
  publishedAt?: string | null;
  modifiedAt?: string | null;
  authorName?: string | null;
  tags?: string[];
};

export type PageSeoInput = {
  title: string;
  description: string;
  canonicalUrl: string;
  type?: "website" | "article";
  imageUrl?: string | null;
  noIndex?: boolean;
  article?: ArticleSeo;
};

function upsertMeta(selector: string, attribute: "name" | "property", key: string, value: string) {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = value;
}
export function applyPageSeo(input: PageSeoInput) {
  if (typeof document === "undefined") return;

  document.title = input.title;
  upsertMeta('meta[name="description"]', "name", "description", input.description);
  upsertMeta(
    'meta[name="robots"]',
    "name",
    "robots",
    input.noIndex ? "noindex, nofollow" : "index, follow, max-image-preview:large",
  );

  let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = input.canonicalUrl;

  const type = input.type || "website";
  upsertMeta('meta[property="og:title"]', "property", "og:title", input.title);
  upsertMeta('meta[property="og:description"]', "property", "og:description", input.description);
  upsertMeta('meta[property="og:type"]', "property", "og:type", type);
  upsertMeta('meta[property="og:url"]', "property", "og:url", input.canonicalUrl);
  upsertMeta('meta[property="og:site_name"]', "property", "og:site_name", "MySession");
  upsertMeta('meta[name="twitter:card"]', "name", "twitter:card", input.imageUrl ? "summary_large_image" : "summary");
  upsertMeta('meta[name="twitter:title"]', "name", "twitter:title", input.title);
  upsertMeta('meta[name="twitter:description"]', "name", "twitter:description", input.description);

  if (input.imageUrl) {
    upsertMeta('meta[property="og:image"]', "property", "og:image", input.imageUrl);
    upsertMeta('meta[name="twitter:image"]', "name", "twitter:image", input.imageUrl);
  }

  if (type === "article" && input.article) {
    if (input.article.publishedAt) {
      upsertMeta(
        'meta[property="article:published_time"]',
        "property",
        "article:published_time",
        input.article.publishedAt,
      );
    }
    if (input.article.modifiedAt) {
      upsertMeta(
        'meta[property="article:modified_time"]',
        "property",
        "article:modified_time",
        input.article.modifiedAt,
      );
    }
  }
}

export function safeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
