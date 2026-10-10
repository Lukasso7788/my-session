import type { BlogPost } from "../lib/blog";
import chooseLengthMarkdown from "../content/blog/choose-25-50-or-90-minute-focus-session.md?raw";
import studyRoutineMarkdown from "../content/blog/body-doubling-study-session-routine.md?raw";
import startWhenStuckMarkdown from "../content/blog/how-to-start-a-focus-session-when-stuck.md?raw";
import remoteWorkMarkdown from "../content/blog/remote-work-accountability-without-meetings.md?raw";
import editorialManifest from "./blog-editorial-manifest.json";
import { starterFocusmatePost, withStarterFocusmateAssets } from "./blogSeed";

const markdownByFile: Record<string, string> = {
  "choose-25-50-or-90-minute-focus-session.md": chooseLengthMarkdown,
  "body-doubling-study-session-routine.md": studyRoutineMarkdown,
  "how-to-start-a-focus-session-when-stuck.md": startWhenStuckMarkdown,
  "remote-work-accountability-without-meetings.md": remoteWorkMarkdown,
};

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
    cover_image_url: null,
    seo_title: entry.seoTitle,
    meta_description: entry.metaDescription,
    focus_keyword: entry.focusKeyword,
    canonical_url: `https://mysession.club/blog/${entry.slug}`,
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
