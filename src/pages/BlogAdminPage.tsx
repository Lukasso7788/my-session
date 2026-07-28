import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  FilePlus2,
  Heading2,
  Link2,
  List,
  Loader2,
  Quote,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import MarkdownArticle from "../components/MarkdownArticle";
import { createStarterFocusmateDraft } from "../data/blogSeed";
import { isCurrentUserAdmin } from "../lib/bans";
import {
  deleteAdminBlogPost,
  estimateReadingMinutes,
  listAdminBlogPosts,
  saveAdminBlogPost,
  slugifyBlogTitle,
  type BlogPost,
  type BlogPostInput,
  type BlogPostStatus,
} from "../lib/blog";
import { supabase } from "../lib/supabase";

const emptyPost = (): BlogPostInput => ({
  title: "",
  slug: "",
  excerpt: "",
  content_markdown: "",
  status: "draft",
  category: "Focus and productivity",
  tags: [],
  author_name: "MySession Editorial",
  cover_image_url: null,
  seo_title: null,
  meta_description: null,
  focus_keyword: null,
  canonical_url: null,
  featured: false,
  published_at: null,
});

function postToInput(post: BlogPost): BlogPostInput {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    content_markdown: post.content_markdown,
    status: post.status,
    category: post.category,
    tags: post.tags || [],
    author_name: post.author_name,
    cover_image_url: post.cover_image_url,
    seo_title: post.seo_title,
    meta_description: post.meta_description,
    focus_keyword: post.focus_keyword,
    canonical_url: post.canonical_url,
    featured: post.featured,
    published_at: post.published_at,
  };
}
function formatUpdatedAt(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <label className="text-[12px] font-medium text-[#454545]">{children}</label>
      {hint ? <span className="text-[10px] text-[#999]">{hint}</span> : null}
    </div>
  );
}

const inputClass =
  "h-10 w-full rounded-[11px] border-0 bg-[#F1F1F1] px-3 text-[13px] text-[#2F2F2F] outline-none transition focus:bg-[#E8E8E8]";

export default function BlogAdminPage() {
  const navigate = useNavigate();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [form, setForm] = useState<BlogPostInput>(emptyPost);
  const [slugTouched, setSlugTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageMissing, setStorageMissing] = useState(false);
  const [mobilePreview, setMobilePreview] = useState(false);

  const loadPosts = async () => {
    setError("");
    try {
      const data = await listAdminBlogPosts();
      setPosts(data);
      setStorageMissing(false);
      return data;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause || "Unable to load blog posts.");
      setError(message);
      setStorageMissing(/blog_posts|relation|schema cache|does not exist/i.test(message));
      return [];
    }
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.user) {
          navigate("/login", { replace: true });
          return;
        }

        const allowed = await isCurrentUserAdmin();
        if (cancelled) return;
        setIsAdmin(allowed);
        if (allowed) await loadPosts();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Admin access check failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const filteredPosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return posts;
    return posts.filter((post) =>
      [post.title, post.slug, post.category, post.tags.join(" ")].join(" ").toLowerCase().includes(needle),
    );
  }, [posts, query]);

  const seoTitle = String(form.seo_title || form.title || "").trim();
  const metaDescription = String(form.meta_description || form.excerpt || "").trim();
  const previewPath = form.slug ? `/blog/${slugifyBlogTitle(form.slug)}` : "";

  const updateForm = <Key extends keyof BlogPostInput>(key: Key, value: BlogPostInput[Key]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const startNew = () => {
    setForm(emptyPost());
    setSlugTouched(false);
    setError("");
    setNotice("");
    setMobilePreview(false);
  };

  const loadStarter = () => {
    const starter = createStarterFocusmateDraft();
    const existing = posts.find((post) => post.slug === starter.slug);
    setForm({
      ...starter,
      id: existing?.id,
      published_at: existing?.published_at || null,
    });
    setSlugTouched(true);
    setError("");
    setNotice(
      existing
        ? "Updated starter loaded into the existing article. Review it, then publish."
        : "Starter article loaded. Review it, add your own experience, then publish.",
    );
  };

  const selectPost = (post: BlogPost) => {
    setForm(postToInput(post));
    setSlugTouched(true);
    setError("");
    setNotice("");
    setMobilePreview(false);
  };

  const insertMarkdown = (before: string, after: string, fallback: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const content = form.content_markdown || "";
    const selected = content.slice(start, end) || fallback;
    const next = `${content.slice(0, start)}${before}${selected}${after}${content.slice(end)}`;
    updateForm("content_markdown", next);

    requestAnimationFrame(() => {
      textarea.focus();
      const nextStart = start + before.length;
      textarea.setSelectionRange(nextStart, nextStart + selected.length);
    });
  };

  const save = async (status: BlogPostStatus) => {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const saved = await saveAdminBlogPost({ ...form, status });
      setForm(postToInput(saved));
      setSlugTouched(true);
      setNotice(status === "published" ? "Article published." : "Draft saved.");
      await loadPosts();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause || "Article could not be saved.");
      setError(message.includes("duplicate key") ? "That URL slug is already used by another article." : message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!form.id || !window.confirm(`Delete “${form.title}”? This cannot be undone.`)) return;

    try {
      setDeleting(true);
      setError("");
      await deleteAdminBlogPost(form.id);
      startNew();
      await loadPosts();
      setNotice("Article deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Article could not be deleted.");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-[70vh] items-center justify-center bg-white text-[#2F2F2F]">
        <Loader2 className="animate-spin" size={24} />
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-[70vh] bg-white px-4 py-16 text-[#2F2F2F]">
        <div className="mx-auto max-w-lg rounded-[24px] bg-[#F5F5F5] p-8 text-center">
          <h1 className="text-[26px] font-semibold">Admin access required</h1>
          <p className="mt-3 text-[14px] leading-6 text-[#666]">Only accounts listed in `admin_users` can edit the MySession blog.</p>
          <Link to="/sessions" className="mt-6 inline-flex rounded-[12px] bg-[#2F2F2F] px-5 py-3 text-[13px] font-medium text-white">Back to sessions</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F5F5F5] text-[#2F2F2F]">
      <div className="mx-auto max-w-[1580px] px-3 py-4 sm:px-5 sm:py-6">
        <header className="rounded-[20px] bg-white px-4 py-4 sm:px-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#777]">
                <Link to="/admin" className="inline-flex items-center gap-1.5 hover:text-[#2F2F2F]"><ArrowLeft size={13} /> Admin</Link>
                <span>·</span>
                <span>Content</span>
              </div>
              <h1 className="mt-2 text-[27px] font-semibold tracking-tight">Blog editor</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {previewPath && form.status === "published" ? (
                <Link to={previewPath} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#EEEEEE] px-4 text-[12px] font-medium hover:bg-[#E5E5E5]">
                  View live <ExternalLink size={14} />
                </Link>
              ) : null}
              <button type="button" onClick={startNew} className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#EEEEEE] px-4 text-[12px] font-medium hover:bg-[#E5E5E5]">
                <FilePlus2 size={15} /> New article
              </button>
              <button type="button" onClick={() => void save("draft")} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#E5F7E7] px-4 text-[12px] font-medium text-[#245C29] disabled:opacity-50">
                <Save size={14} /> Save draft
              </button>
              <button type="button" onClick={() => void save("published")} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-[11px] bg-[#2F2F2F] px-4 text-[12px] font-medium text-white disabled:opacity-50">
                {saving ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />} Publish
              </button>
            </div>
          </div>
        </header>

        {storageMissing ? (
          <div className="mt-3 rounded-[16px] bg-amber-50 px-4 py-3 text-[12px] leading-5 text-amber-800">
            The `blog_posts` table is not installed yet. The editor is ready, but saving requires the Supabase SQL supplied with this change.
          </div>
        ) : null}
        {error ? <div className="mt-3 rounded-[16px] bg-red-50 px-4 py-3 text-[12px] text-red-700">{error}</div> : null}
        {notice ? <div className="mt-3 rounded-[16px] bg-[#EAF8EB] px-4 py-3 text-[12px] text-[#245C29]">{notice}</div> : null}

        <div className="mt-3 grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_minmax(360px,0.85fr)]">
          <aside className="rounded-[20px] bg-white p-3 xl:sticky xl:top-3 xl:h-[calc(100vh-24px)] xl:overflow-y-auto">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#999]" size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search articles" className="h-10 w-full rounded-[11px] border-0 bg-[#F1F1F1] pl-9 pr-3 text-[12px] outline-none" />
            </div>

            <button type="button" onClick={loadStarter} className="mt-2 flex w-full items-center gap-2 rounded-[11px] bg-[#EAF8EB] px-3 py-2.5 text-left text-[11px] font-medium text-[#245C29] hover:bg-[#DFF3E1]">
              <Sparkles size={14} /> Load Focusmate starter
            </button>

            <div className="mt-4 flex items-center justify-between px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#999]">
              <span>Articles</span><span>{posts.length}</span>
            </div>
            <div className="mt-2 space-y-1.5">
              {filteredPosts.map((post) => {
                const active = form.id === post.id;
                return (
                  <button key={post.id} type="button" onClick={() => selectPost(post)} className={["w-full rounded-[12px] px-3 py-3 text-left transition", active ? "bg-[#2F2F2F] text-white" : "bg-[#F5F5F5] hover:bg-[#ECECEC]"].join(" ")}>
                    <div className="line-clamp-2 text-[12px] font-medium leading-5">{post.title}</div>
                    <div className={["mt-2 flex items-center justify-between gap-2 text-[10px]", active ? "text-white/65" : "text-[#888]"].join(" ")}>
                      <span>{post.status}</span><span>{formatUpdatedAt(post.updated_at)}</span>
                    </div>
                  </button>
                );
              })}
              {!filteredPosts.length ? <div className="px-3 py-5 text-center text-[11px] text-[#999]">No saved articles yet.</div> : null}
            </div>
          </aside>

          <section className={mobilePreview ? "hidden xl:block" : "rounded-[20px] bg-white p-4 sm:p-5"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <FieldLabel>Article title</FieldLabel>
                <input
                  value={form.title}
                  onChange={(event) => {
                    const title = event.target.value;
                    setForm((current) => ({ ...current, title, slug: slugTouched ? current.slug : slugifyBlogTitle(title) }));
                  }}
                  className="w-full border-0 bg-transparent text-[25px] font-semibold tracking-tight outline-none placeholder:text-[#BBB]"
                  placeholder="A useful, specific article title"
                />
              </div>

              <div className="sm:col-span-2">
                <FieldLabel hint={`${form.excerpt.length}/220`}>Short answer / excerpt</FieldLabel>
                <textarea value={form.excerpt} onChange={(event) => updateForm("excerpt", event.target.value.slice(0, 220))} rows={3} className="w-full resize-none rounded-[12px] border-0 bg-[#F1F1F1] px-3 py-3 text-[13px] leading-6 outline-none focus:bg-[#E8E8E8]" placeholder="Answer the searcher's main question in one or two direct sentences." />
              </div>

              <div>
                <FieldLabel>URL slug</FieldLabel>
                <input value={form.slug} onChange={(event) => { setSlugTouched(true); updateForm("slug", slugifyBlogTitle(event.target.value)); }} className={inputClass} placeholder="focusmate-alternative" />
              </div>
              <div>
                <FieldLabel>Category</FieldLabel>
                <input value={form.category} onChange={(event) => updateForm("category", event.target.value)} className={inputClass} />
              </div>
              <div>
                <FieldLabel>Author</FieldLabel>
                <input value={form.author_name} onChange={(event) => updateForm("author_name", event.target.value)} className={inputClass} />
              </div>
              <div>
                <FieldLabel>Tags <span className="font-normal text-[#999]">(comma separated)</span></FieldLabel>
                <input value={form.tags.join(", ")} onChange={(event) => updateForm("tags", event.target.value.split(",").map((tag) => tag.trim()).filter(Boolean))} className={inputClass} placeholder="body doubling, focus rooms" />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel>Cover image URL</FieldLabel>
                <input value={form.cover_image_url || ""} onChange={(event) => updateForm("cover_image_url", event.target.value || null)} className={inputClass} placeholder="https://… or /images/blog/…" />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-1 rounded-[12px] bg-[#F1F1F1] p-1.5">
              <button type="button" title="Heading" onClick={() => insertMarkdown("## ", "", "Section heading")} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white"><Heading2 size={15} /></button>
              <button type="button" title="Bold" onClick={() => insertMarkdown("**", "**", "important text")} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[13px] font-bold hover:bg-white">B</button>
              <button type="button" title="Bulleted list" onClick={() => insertMarkdown("- ", "", "List item")} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white"><List size={15} /></button>
              <button type="button" title="Quote" onClick={() => insertMarkdown("> ", "", "Useful quotation or takeaway")} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white"><Quote size={15} /></button>
              <button type="button" title="Link" onClick={() => insertMarkdown("[", "](https://example.com)", "link text")} className="flex h-8 w-8 items-center justify-center rounded-[8px] hover:bg-white"><Link2 size={15} /></button>
              <span className="ml-auto px-2 text-[10px] text-[#888]">{estimateReadingMinutes(form.content_markdown)} min read</span>
            </div>

            <textarea ref={textareaRef} value={form.content_markdown} onChange={(event) => updateForm("content_markdown", event.target.value)} className="mt-2 min-h-[560px] w-full resize-y rounded-[14px] border-0 bg-[#F7F7F7] px-4 py-4 font-mono text-[13px] leading-6 outline-none focus:bg-[#F3F3F3]" placeholder="Write in Markdown…" />

            <div className="mt-6 rounded-[16px] bg-[#F5F5F5] p-4">
              <h2 className="text-[14px] font-semibold">Search and answer metadata</h2>
              <p className="mt-1 text-[11px] leading-5 text-[#777]">Keep this accurate and human-readable. Empty fields fall back to the article title and excerpt.</p>
              <div className="mt-4 space-y-4">
                <div>
                  <FieldLabel hint={`${seoTitle.length}/60`}>SEO title</FieldLabel>
                  <input value={form.seo_title || ""} onChange={(event) => updateForm("seo_title", event.target.value || null)} className={inputClass} placeholder={form.title || "Article title | MySession"} />
                </div>
                <div>
                  <FieldLabel hint={`${metaDescription.length}/160`}>Meta description</FieldLabel>
                  <textarea value={form.meta_description || ""} onChange={(event) => updateForm("meta_description", event.target.value.slice(0, 180) || null)} rows={3} className="w-full resize-none rounded-[12px] border-0 bg-white px-3 py-3 text-[12px] leading-5 outline-none" placeholder={form.excerpt || "Direct summary of the article"} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div><FieldLabel>Focus phrase</FieldLabel><input value={form.focus_keyword || ""} onChange={(event) => updateForm("focus_keyword", event.target.value || null)} className={inputClass + " bg-white"} placeholder="Focusmate alternative" /></div>
                  <div><FieldLabel>Canonical URL <span className="font-normal text-[#999]">(optional)</span></FieldLabel><input value={form.canonical_url || ""} onChange={(event) => updateForm("canonical_url", event.target.value || null)} className={inputClass + " bg-white"} placeholder={`https://mysession.club${previewPath || "/blog/…"}`} /></div>
                </div>
                <label className="flex items-center gap-2 text-[12px] text-[#555]"><input type="checkbox" checked={form.featured} onChange={(event) => updateForm("featured", event.target.checked)} /> Feature this article on the blog page</label>
              </div>
            </div>

            {form.id ? (
              <button type="button" onClick={() => void remove()} disabled={deleting} className="mt-5 inline-flex h-10 items-center gap-2 rounded-[11px] bg-red-50 px-4 text-[12px] font-medium text-red-600 disabled:opacity-50">
                <Trash2 size={14} /> {deleting ? "Deleting…" : "Delete article"}
              </button>
            ) : null}
          </section>

          <section className={mobilePreview ? "rounded-[20px] bg-white p-4 sm:p-6" : "hidden rounded-[20px] bg-white p-4 sm:p-6 xl:block xl:sticky xl:top-3 xl:h-[calc(100vh-24px)] xl:overflow-y-auto"}>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#999]">Live preview</div>
            <div className="mt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5B9D61]">{form.category || "Category"}</div>
            <h1 className="mt-2 text-[32px] font-semibold leading-[1.08] tracking-[-0.03em]">{form.title || "Your article title"}</h1>
            <p className="mt-4 text-[14px] leading-6 text-[#777]">{form.excerpt || "The article's short answer will appear here."}</p>
            <div className="mt-4 text-[11px] text-[#999]">{form.author_name || "MySession Editorial"} · {estimateReadingMinutes(form.content_markdown)} min read</div>
            <div className="mt-7 border-t border-[#ECECEC] pt-1"><MarkdownArticle markdown={form.content_markdown || "## Start writing\n\nYour formatted article will appear here."} /></div>
          </section>
        </div>

        <button type="button" onClick={() => setMobilePreview((value) => !value)} className="fixed bottom-4 right-4 z-20 inline-flex h-11 items-center gap-2 rounded-[13px] bg-[#2F2F2F] px-4 text-[12px] font-medium text-white shadow-lg xl:hidden">
          {mobilePreview ? "Edit article" : "Preview article"}
        </button>
      </div>
    </main>
  );
}
