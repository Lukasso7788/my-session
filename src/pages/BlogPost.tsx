import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Clock3 } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import MarkdownArticle from "../components/MarkdownArticle";
import { starterFocusmatePost, withStarterFocusmateAssets } from "../data/blogSeed";
import {
  estimateReadingMinutes,
  getPublishedBlogPost,
  listPublishedBlogPosts,
  type BlogPost as BlogPostRecord,
} from "../lib/blog";
import { applyPageSeo, safeJsonLd } from "../lib/pageSeo";

const SITE_ORIGIN = "https://mysession.club";
const FOCUSMATE_COVER_ALT =
  "Three colleagues working together around laptops and documents at a shared office desk";

function absoluteSiteUrl(value?: string | null) {
  if (!value) return undefined;
  try {
    return new URL(value, SITE_ORIGIN).href;
  } catch {
    return value;
  }
}

function formatLongDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
export default function BlogPost() {
  const { slug = "" } = useParams();
  const [post, setPost] = useState<BlogPostRecord | null>(
    slug === starterFocusmatePost.slug ? starterFocusmatePost : null,
  );
  const [relatedPosts, setRelatedPosts] = useState<BlogPostRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const [databasePost, publishedPosts] = await Promise.all([
          getPublishedBlogPost(slug),
          listPublishedBlogPosts(5),
        ]);
        if (cancelled) return;

        const fallback = slug === starterFocusmatePost.slug ? starterFocusmatePost : null;
        setPost(databasePost ? withStarterFocusmateAssets(databasePost) : fallback);
        setRelatedPosts(publishedPosts.filter((candidate) => candidate.slug !== slug).slice(0, 3));
      } catch (error) {
        console.warn("[blog] article load failed", error);
        if (!cancelled) {
          setPost(slug === starterFocusmatePost.slug ? starterFocusmatePost : null);
          setRelatedPosts([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    if (loading) return;
    if (!post) {
      applyPageSeo({
        title: "Article not found | MySession",
        description: "This MySession article is not available.",
        canonicalUrl: `${SITE_ORIGIN}/blog/${slug}`,
        noIndex: true,
      });
      return;
    }

    const canonicalUrl = post.canonical_url || `${SITE_ORIGIN}/blog/${post.slug}`;
    applyPageSeo({
      title: post.seo_title || `${post.title} | MySession`,
      description: post.meta_description || post.excerpt,
      canonicalUrl,
      type: "article",
      imageUrl: post.cover_image_url,
      imageAlt:
        post.slug === starterFocusmatePost.slug
          ? FOCUSMATE_COVER_ALT
          : `Cover image for ${post.title}`,
      article: {
        publishedAt: post.published_at,
        modifiedAt: post.updated_at,
        authorName: post.author_name,
        tags: post.tags,
      },
    });
  }, [loading, post, slug]);

  if (loading && !post) {
    return (
      <main className="min-h-[65vh] bg-white px-4 py-20 text-center text-[14px] text-[#777]">
        Loading article…
      </main>
    );
  }

  if (!post) {
    return (
      <main className="min-h-[65vh] bg-white px-4 py-20 text-[#2F2F2F]">
        <div className="mx-auto max-w-xl rounded-[24px] bg-[#F5F5F5] p-8 text-center">
          <h1 className="text-[28px] font-semibold">Article not found</h1>
          <p className="mt-3 text-[14px] leading-6 text-[#666]">The article may still be a draft or its address may have changed.</p>
          <Link to="/blog" className="mt-6 inline-flex items-center gap-2 rounded-[13px] bg-[#2F2F2F] px-5 py-3 text-[13px] font-medium text-white">
            <ArrowLeft size={15} /> Back to blog
          </Link>
        </div>
      </main>
    );
  }

  const canonicalUrl = post.canonical_url || `${SITE_ORIGIN}/blog/${post.slug}`;
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.meta_description || post.excerpt,
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    author: { "@type": "Organization", name: post.author_name || "MySession Editorial" },
    publisher: { "@type": "Organization", name: "MySession", url: SITE_ORIGIN },
    image: absoluteSiteUrl(post.cover_image_url),
    keywords: post.tags.join(", "),
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "MySession", item: SITE_ORIGIN },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_ORIGIN}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: canonicalUrl },
    ],
  };

  return (
    <main className="min-h-screen bg-white text-[#2F2F2F]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(articleJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }} />

      <header className="mx-auto max-w-[900px] px-4 pb-8 pt-10 sm:px-6 sm:pt-14">
        <Link to="/blog" className="inline-flex items-center gap-2 text-[12px] font-medium text-[#777] transition hover:text-[#2F2F2F]">
          <ArrowLeft size={14} /> MySession Blog
        </Link>

        <div className="mt-9 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#5B9D61]">{post.category}</div>
        <h1 className="mt-3 max-w-[850px] text-[36px] font-semibold leading-[1.08] tracking-[-0.035em] sm:text-[54px]">
          {post.title}
        </h1>
        <p className="mt-6 max-w-3xl text-[17px] leading-8 text-[#666]">{post.excerpt}</p>

        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#777]">
          <span className="font-medium text-[#2F2F2F]">{post.author_name}</span>
          <span>{formatLongDate(post.published_at)}</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> {estimateReadingMinutes(post.content_markdown)} min read</span>
        </div>
      </header>

      {post.cover_image_url ? (
        <div className="mx-auto max-w-[1080px] px-4 sm:px-6">
          <img
            src={post.cover_image_url}
            alt={
              post.slug === starterFocusmatePost.slug
                ? FOCUSMATE_COVER_ALT
                : `Cover illustration for ${post.title}`
            }
            className="max-h-[560px] w-full rounded-[26px] bg-[#F7F7F7] object-cover"
          />
          {post.slug === starterFocusmatePost.slug ? (
            <p className="mt-2 px-1 text-right text-[11px] text-[#888]">
              Photo by{" "}
              <a
                href="https://www.pexels.com/photo/people-working-on-laptops-7988692/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Mikhail Nilov
              </a>{" "}
              on Pexels · MySession edit
            </p>
          ) : null}
        </div>
      ) : null}

      <article className="mx-auto max-w-[760px] px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <MarkdownArticle markdown={post.content_markdown} />

        <div className="mt-12 rounded-[22px] bg-[#EAF8EB] p-6 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <h2 className="text-[20px] font-semibold">Turn the next task into a real session.</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#5D6B5E]">Join other people who are already focusing in MySession.</p>
          </div>
          <Link to="/sessions" className="mt-5 inline-flex h-10 shrink-0 items-center gap-2 rounded-[12px] bg-[#2F2F2F] px-4 text-[12px] font-medium text-white sm:mt-0">
            Browse sessions <ArrowRight size={14} />
          </Link>
        </div>

        {post.tags.length > 0 ? (
          <div className="mt-8 flex flex-wrap gap-2">
            {post.tags.map((tag) => (
              <span key={tag} className="rounded-[9px] bg-[#F2F2F2] px-3 py-1.5 text-[11px] text-[#666]">{tag}</span>
            ))}
          </div>
        ) : null}
      </article>

      {relatedPosts.length > 0 ? (
        <section className="border-t border-[#ECECEC] bg-[#F7F7F7] px-4 py-12 sm:px-6">
          <div className="mx-auto max-w-[980px]">
            <h2 className="text-[24px] font-semibold">Continue reading</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {relatedPosts.map((related) => (
                <Link key={related.id} to={`/blog/${related.slug}`} className="rounded-[18px] bg-white p-5 transition hover:bg-[#EFEFEF]">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-[#888]">{related.category}</div>
                  <div className="mt-3 text-[16px] font-semibold leading-6">{related.title}</div>
                  <div className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-[#777]"><Clock3 size={12} /> {estimateReadingMinutes(related.content_markdown)} min</div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
