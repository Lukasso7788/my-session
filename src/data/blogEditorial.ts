import type { BlogPost } from "../lib/blog";
import chooseLengthMarkdown from "../content/blog/choose-25-50-or-90-minute-focus-session.md?raw";
import studyRoutineMarkdown from "../content/blog/body-doubling-study-session-routine.md?raw";
import startWhenStuckMarkdown from "../content/blog/how-to-start-a-focus-session-when-stuck.md?raw";
import remoteWorkMarkdown from "../content/blog/remote-work-accountability-without-meetings.md?raw";
import whatIsBodyDoublingMarkdown from "../content/blog/what-is-body-doubling.md?raw";
import editorialManifest from "./blog-editorial-manifest.json";
import { starterFocusmatePost, withStarterFocusmateAssets } from "./blogSeed";

const markdownByFile: Record<string, string> = {
  "choose-25-50-or-90-minute-focus-session.md": chooseLengthMarkdown,
  "body-doubling-study-session-routine.md": studyRoutineMarkdown,
  "how-to-start-a-focus-session-when-stuck.md": startWhenStuckMarkdown,
  "remote-work-accountability-without-meetings.md": remoteWorkMarkdown,
  "what-is-body-doubling.md": whatIsBodyDoublingMarkdown,
};

const coverDetailsBySlug = new Map(
  editorialManifest.map((entry) => [entry.slug, {
    path: entry.coverImagePath,
    alt: entry.coverImageAlt,
  }]),
);

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
