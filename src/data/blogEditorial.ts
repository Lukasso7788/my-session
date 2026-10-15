import type { BlogPost } from "../lib/blog";
import editorialCoverSources from "../../scripts/editorial-covers/sources.json";
import editorialManifest from "./blog-editorial-manifest.json";
import { starterFocusmatePost, withStarterFocusmateAssets } from "./blogSeed";

// The manifest drives publishing; discover its Markdown automatically so a new
// prerendered article cannot be missing from the browser bundle's manual imports.
const markdownModules = import.meta.glob<string>("../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const markdownByFile = Object.fromEntries(
  Object.entries(markdownModules).map(([file, markdown]) => [file.split("/").pop()!, markdown]),
);

const coverDetailsBySlug = new Map(
  editorialManifest.map((entry) => [entry.slug, {
    path: entry.coverImagePath,
    alt: entry.coverImageAlt,
  }]),
);

const coverPhotoBySlug = new Map(editorialCoverSources.map((source) => [source.slug, source]));

export function getBlogCoverCredit(post: BlogPost): { name: string; url: string } | null {
  if (post.slug === starterFocusmatePost.slug && post.cover_image_url === starterFocusmatePost.cover_image_url) {
    return { name: "Mikhail Nilov", url: "https://www.pexels.com/photo/people-working-on-laptops-7988692/" };
  }
  const editorialCover = coverDetailsBySlug.get(post.slug);
  const source = coverPhotoBySlug.get(post.slug);
  if (!editorialCover || !source || post.cover_image_url !== editorialCover.path) return null;
  return { name: source.photographer, url: source.sourcePage };
}

export function getBlogCoverAlt(post: BlogPost): string {
  if (post.slug === starterFocusmatePost.slug && post.cover_image_url === starterFocusmatePost.cover_image_url) {
    return "Three colleagues working together around laptops and documents at a shared office desk";
  }
  const editorialCover = coverDetailsBySlug.get(post.slug);
  if (editorialCover && post.cover_image_url === editorialCover.path) return editorialCover.alt;
  return `Cover image for ${post.title}`;
}

export function getBlogPostRoute(post: BlogPost): string {
  const entry = editorialManifest.find((candidate) => candidate.slug === post.slug);
  return entry && "route" in entry && entry.route ? entry.route : `/blog/${post.slug}`;
}

export const bundledBlogPosts: BlogPost[] = [
  starterFocusmatePost,
  ...editorialManifest.map((entry): BlogPost => ({
    id: `bundled-${entry.slug}`,
    slug: entry.slug,
    title: entry.title,
    excerpt: entry.excerpt,
    content_markdown: markdownByFile[entry.markdownFile],
    status: "published",
    category: entry.category,
    tags: entry.tags,
    author_name: "MySession Editorial",
    cover_image_url: entry.coverImagePath,
    seo_title: entry.seoTitle,
    meta_description: entry.metaDescription,
    focus_keyword: entry.focusKeyword,
    canonical_url: `https://mysession.club${"route" in entry && entry.route ? entry.route : `/blog/${entry.slug}`}`,
    featured: false,
    published_at: entry.publishedAt,
    created_at: entry.publishedAt,
    updated_at: entry.publishedAt,
    created_by: null,
    updated_by: null,
  })),
];

const bundledBySlug = new Map(bundledBlogPosts.map((post) => [post.slug, post]));

export function getBundledBlogPost(slug: string): BlogPost | null {
  return bundledBySlug.get(slug) || null;
}

// Admin-published records keep priority when they share a slug with a bundled
// article. Bundled editorial remains available when the database is offline.
export function mergePublishedBlogPosts(databasePosts: BlogPost[]): BlogPost[] {
  const slugs = new Set(databasePosts.map((post) => post.slug));
  return [
    ...databasePosts.map(withStarterFocusmateAssets),
    ...bundledBlogPosts.filter((post) => !slugs.has(post.slug)),
  ];
}
