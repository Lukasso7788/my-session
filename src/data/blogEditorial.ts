import type { BlogPost } from "../lib/blog";
import chooseLengthMarkdown from "../content/blog/choose-25-50-or-90-minute-focus-session.md?raw";
import studyRoutineMarkdown from "../content/blog/body-doubling-study-session-routine.md?raw";
import startWhenStuckMarkdown from "../content/blog/how-to-start-a-focus-session-when-stuck.md?raw";
import remoteWorkMarkdown from "../content/blog/remote-work-accountability-without-meetings.md?raw";
import whatIsBodyDoublingMarkdown from "../content/blog/what-is-body-doubling.md?raw";
import groupVsOneOnOneMarkdown from "../content/blog/group-vs-one-on-one-body-doubling.md?raw";
import accountabilityPartnerMarkdown from "../content/blog/accountability-partner-vs-body-double.md?raw";
import coworkingEtiquetteMarkdown from "../content/blog/virtual-coworking-etiquette.md?raw";
import cameraOnOrOffMarkdown from "../content/blog/body-doubling-camera-on-or-off.md?raw";
import groupPomodoroMarkdown from "../content/blog/group-pomodoro-sessions.md?raw";
import scheduledVsDropInMarkdown from "../content/blog/scheduled-vs-drop-in-focus-sessions.md?raw";
import sessionIntentionMarkdown from "../content/blog/how-to-write-a-focus-session-intention.md?raw";
import cleaningMarkdown from "../content/blog/body-doubling-for-cleaning.md?raw";
import studyWithMeMarkdown from "../content/blog/study-with-me-videos-vs-live-study-rooms.md?raw";
import hostSessionMarkdown from "../content/blog/how-to-host-a-virtual-coworking-session.md?raw";
import bestAppsMarkdown from "../content/blog/best-body-doubling-apps.md?raw";
import taskParalysisMarkdown from "../content/blog/task-paralysis.md?raw";
import taskInitiationMarkdown from "../content/blog/task-initiation-strategies.md?raw";
import withoutAdhdMarkdown from "../content/blog/does-body-doubling-work-without-adhd.md?raw";
import editorialCoverSources from "../../scripts/editorial-covers/sources.json";
import editorialManifest from "./blog-editorial-manifest.json";
import { starterFocusmatePost, withStarterFocusmateAssets } from "./blogSeed";

const markdownByFile: Record<string, string> = {
  "choose-25-50-or-90-minute-focus-session.md": chooseLengthMarkdown,
  "body-doubling-study-session-routine.md": studyRoutineMarkdown,
  "how-to-start-a-focus-session-when-stuck.md": startWhenStuckMarkdown,
  "remote-work-accountability-without-meetings.md": remoteWorkMarkdown,
  "what-is-body-doubling.md": whatIsBodyDoublingMarkdown,
  "group-vs-one-on-one-body-doubling.md": groupVsOneOnOneMarkdown,
  "accountability-partner-vs-body-double.md": accountabilityPartnerMarkdown,
  "virtual-coworking-etiquette.md": coworkingEtiquetteMarkdown,
  "body-doubling-camera-on-or-off.md": cameraOnOrOffMarkdown,
  "group-pomodoro-sessions.md": groupPomodoroMarkdown,
  "scheduled-vs-drop-in-focus-sessions.md": scheduledVsDropInMarkdown,
  "how-to-write-a-focus-session-intention.md": sessionIntentionMarkdown,
  "body-doubling-for-cleaning.md": cleaningMarkdown,
  "study-with-me-videos-vs-live-study-rooms.md": studyWithMeMarkdown,
  "how-to-host-a-virtual-coworking-session.md": hostSessionMarkdown,
  "best-body-doubling-apps.md": bestAppsMarkdown,
  "task-paralysis.md": taskParalysisMarkdown,
  "task-initiation-strategies.md": taskInitiationMarkdown,
  "does-body-doubling-work-without-adhd.md": withoutAdhdMarkdown,
};

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
