import { supabase } from "./supabase";

export type BlogPostStatus = "draft" | "published";

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content_markdown: string;
  status: BlogPostStatus;
  category: string;
  tags: string[];
  author_name: string;
  cover_image_url: string | null;
  seo_title: string | null;
  meta_description: string | null;
  focus_keyword: string | null;
  canonical_url: string | null;
  featured: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
};

export type BlogPostInput = Omit<
  BlogPost,
  "id" | "created_at" | "updated_at" | "created_by" | "updated_by"
> & {
  id?: string;
};

const BLOG_POST_FIELDS = [
  "id",
  "slug",
  "title",
  "excerpt",
  "content_markdown",
  "status",
  "category",
  "tags",
  "author_name",
  "cover_image_url",
  "seo_title",
  "meta_description",
  "focus_keyword",
  "canonical_url",
  "featured",
  "published_at",
  "created_at",
  "updated_at",
  "created_by",
  "updated_by",
].join(", ");

export function slugifyBlogTitle(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

export function estimateReadingMinutes(markdown: string) {
  const words = String(markdown || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  return Math.max(1, Math.ceil(words / 220));
}

export function normalizeBlogPostInput(input: BlogPostInput) {
  const status: BlogPostStatus = input.status === "published" ? "published" : "draft";
  const now = new Date().toISOString();

  return {
    slug: slugifyBlogTitle(input.slug || input.title),
    title: String(input.title || "").trim(),
    excerpt: String(input.excerpt || "").trim(),
    content_markdown: String(input.content_markdown || "").trim(),
    status,
    category: String(input.category || "Focus and productivity").trim(),
    tags: Array.from(
      new Set((input.tags || []).map((tag) => String(tag || "").trim()).filter(Boolean)),
    ).slice(0, 12),
    author_name: String(input.author_name || "MySession Editorial").trim(),
    cover_image_url: String(input.cover_image_url || "").trim() || null,
    seo_title: String(input.seo_title || "").trim() || null,
    meta_description: String(input.meta_description || "").trim() || null,
    focus_keyword: String(input.focus_keyword || "").trim() || null,
    canonical_url: String(input.canonical_url || "").trim() || null,
    featured: Boolean(input.featured),
    published_at:
      status === "published" ? input.published_at || now : input.published_at || null,
  };
}

export async function listPublishedBlogPosts(limit = 50) {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(BLOG_POST_FIELDS)
    .eq("status", "published")
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data || []) as unknown as BlogPost[];
}

export async function getPublishedBlogPost(slug: string) {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(BLOG_POST_FIELDS)
    .eq("slug", slugifyBlogTitle(slug))
    .eq("status", "published")
    .maybeSingle();

  if (error) throw error;
  return (data || null) as BlogPost | null;
}

export async function listAdminBlogPosts() {
  const { data, error } = await supabase
    .from("blog_posts")
    .select(BLOG_POST_FIELDS)
    .order("updated_at", { ascending: false })
    .limit(250);

  if (error) throw error;
  return (data || []) as unknown as BlogPost[];
}

export async function saveAdminBlogPost(input: BlogPostInput) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = String(sessionData.session?.user?.id || "").trim();
  if (!userId) throw new Error("Sign in with an admin account first.");

  const normalized = normalizeBlogPostInput(input);
  if (!normalized.title) throw new Error("Article title is required.");
  if (!normalized.slug) throw new Error("Article URL slug is required.");
  if (!normalized.excerpt) throw new Error("Article excerpt is required.");
  if (!normalized.content_markdown) throw new Error("Article content is required.");

  if (input.id) {
    const { data, error } = await supabase
      .from("blog_posts")
      .update({ ...normalized, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .select(BLOG_POST_FIELDS)
      .single();

    if (error) throw error;
    return data as unknown as BlogPost;
  }

  const { data, error } = await supabase
    .from("blog_posts")
    .insert({ ...normalized, created_by: userId, updated_by: userId })
    .select(BLOG_POST_FIELDS)
    .single();

  if (error) throw error;
  return data as unknown as BlogPost;
}

export async function deleteAdminBlogPost(id: string) {
  const { error } = await supabase.from("blog_posts").delete().eq("id", id);
  if (error) throw error;
}
