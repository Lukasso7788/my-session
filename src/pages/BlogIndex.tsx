import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { starterFocusmatePost } from "../data/blogSeed";
import { estimateReadingMinutes, listPublishedBlogPosts, type BlogPost } from "../lib/blog";
import { applyPageSeo, safeJsonLd } from "../lib/pageSeo";

const SITE_ORIGIN = "https://mysession.club";

function formatPostDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
function PostCard({ post, featured = false }: { post: BlogPost; featured?: boolean }) {
  return (
    <article
      className={[
        "group overflow-hidden rounded-[24px] bg-[#F5F5F5] transition duration-200 hover:bg-[#EFEFEF]",
        featured ? "grid md:grid-cols-[1.15fr_0.85fr]" : "flex h-full flex-col",
      ].join(" ")}
    >
      {post.cover_image_url ? (
        <div className={featured ? "min-h-[260px] md:order-2" : "aspect-[16/9]"}>
          <img
            src={post.cover_image_url}
            alt=""
            className="h-full w-full object-cover"
            loading={featured ? "eager" : "lazy"}
          />
        </div>
      ) : featured ? (
        <div className="relative min-h-[260px] overflow-hidden bg-[#DFF4E1] md:order-2">
          <div className="absolute left-[15%] top-[22%] h-40 w-40 rounded-full bg-[#81DB86]/65" />
          <div className="absolute bottom-[-40px] right-[-15px] h-64 w-64 rounded-full bg-[#2F2F2F]" />
          <div className="absolute bottom-12 right-12 rounded-[18px] bg-white px-5 py-4 text-[14px] font-medium text-[#2F2F2F] shadow-sm">
            Focus together.
            <br />
            Start with less friction.
          </div>
        </div>
      ) : null}

      <div className={featured ? "flex flex-col justify-center p-6 sm:p-8" : "flex flex-1 flex-col p-5"}>
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#777]">
          <span>{post.category || "Focus and productivity"}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
            <Clock3 size={12} /> {estimateReadingMinutes(post.content_markdown)} min read
          </span>
        </div>

        <h2
          className={[
            "mt-4 font-semibold leading-tight tracking-tight text-[#2F2F2F]",
            featured ? "text-[28px] sm:text-[36px]" : "text-[21px]",
          ].join(" ")}
        >
          <Link to={`/blog/${post.slug}`} className="outline-none focus-visible:underline">
            {post.title}
          </Link>
        </h2>

        <p className="mt-4 text-[14px] leading-6 text-[#666]">{post.excerpt}</p>

        <div className="mt-6 flex items-center justify-between gap-3">
          <span className="text-[12px] text-[#888]">{formatPostDate(post.published_at)}</span>
          <Link
            to={`/blog/${post.slug}`}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-[#2F2F2F] transition group-hover:gap-3"
          >
            Read article <ArrowRight size={15} />
          </Link>
        </div>
      </div>
    </article>
  );
}

export default function BlogIndex() {
  const [posts, setPosts] = useState<BlogPost[]>([starterFocusmatePost]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    applyPageSeo({
      title: "MySession Blog | Body Doubling and Focus Guides",
      description:
        "Practical guides to virtual coworking, body doubling, focus sessions, accountability, and building a repeatable work routine.",
      canonicalUrl: `${SITE_ORIGIN}/blog`,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const databasePosts = await listPublishedBlogPosts();
        if (cancelled) return;
        const hasStarter = databasePosts.some((post) => post.slug === starterFocusmatePost.slug);
        setPosts(hasStarter ? databasePosts : [starterFocusmatePost, ...databasePosts]);
      } catch (error) {
        console.warn("[blog] published posts unavailable; using bundled article", error);
        if (!cancelled) setPosts([starterFocusmatePost]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const featuredPost = posts[0] || starterFocusmatePost;
  const remainingPosts = useMemo(() => posts.slice(1), [posts]);

  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "MySession Blog",
    url: `${SITE_ORIGIN}/blog`,
    description:
      "Guides to body doubling, virtual coworking, accountability, and structured focus sessions.",
    publisher: {
      "@type": "Organization",
      name: "MySession",
      url: SITE_ORIGIN,
    },
    blogPost: posts.slice(0, 10).map((post) => ({
      "@type": "BlogPosting",
      headline: post.title,
      url: `${SITE_ORIGIN}/blog/${post.slug}`,
      datePublished: post.published_at,
    })),
  };

  return (
    <main className="min-h-screen bg-white text-[#2F2F2F]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(blogJsonLd) }} />

      <section className="mx-auto max-w-[1180px] px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
        <div className="flex max-w-3xl items-start gap-4">
          <div className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#E5F7E7] text-[#245C29]">
            <BookOpen size={20} />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5B9D61]">MySession Journal</div>
            <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-tight sm:text-[48px]">
              Better ways to begin,
              <br className="hidden sm:block" /> focus, and follow through.
            </h1>
            <p className="mt-5 max-w-2xl text-[16px] leading-7 text-[#666]">
              Practical, honest guides to body doubling, virtual coworking, accountability, and building a focus routine you can actually repeat.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 pb-16 sm:px-6">
        <PostCard post={featuredPost} featured />

        {remainingPosts.length > 0 ? (
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {remainingPosts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
        ) : null}

        {loading ? <div className="mt-6 text-center text-[12px] text-[#999]">Checking for new articles…</div> : null}
      </section>

      <section className="border-t border-[#ECECEC] bg-[#F7F7F7] px-4 py-14 sm:px-6">
        <div className="mx-auto flex max-w-[920px] flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-[25px] font-semibold tracking-tight">Ready to focus with other people?</h2>
            <p className="mt-2 text-[14px] leading-6 text-[#666]">Join a scheduled session or step into a 24/7 focus room.</p>
          </div>
          <Link
            to="/sessions"
            className="inline-flex h-11 shrink-0 items-center justify-center rounded-[13px] bg-[#2F2F2F] px-5 text-[13px] font-medium text-white transition hover:bg-[#202020]"
          >
            Browse sessions
          </Link>
        </div>
      </section>
    </main>
  );
}
