import { useMemo } from "react";
import { marked } from "marked";

function isSafeUrl(value: string, attribute: string) {
  const url = String(value || "").trim();
  if (!url) return true;
  if (url.startsWith("#") || url.startsWith("/")) return true;
  if (attribute === "href" && url.startsWith("mailto:")) return true;

  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
function sanitizeArticleHtml(html: string) {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";

  const documentNode = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const blocked = new Set([
    "SCRIPT",
    "STYLE",
    "IFRAME",
    "OBJECT",
    "EMBED",
    "FORM",
    "INPUT",
    "BUTTON",
    "TEXTAREA",
    "SELECT",
    "META",
    "LINK",
    "BASE",
  ]);

  for (const element of Array.from(documentNode.body.querySelectorAll("*"))) {
    if (blocked.has(element.tagName)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "formaction"
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }

      if ((name === "href" || name === "src") && !isSafeUrl(attribute.value, name)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.tagName === "A") {
      element.setAttribute("rel", "noopener noreferrer");
      const href = element.getAttribute("href") || "";
      if (/^https?:\/\//i.test(href)) element.setAttribute("target", "_blank");
    }
  }

  return documentNode.body.innerHTML;
}

export default function MarkdownArticle({ markdown }: { markdown: string }) {
  const html = useMemo(() => {
    const parsed = marked.parse(String(markdown || ""), {
      async: false,
      gfm: true,
      breaks: false,
    }) as string;
    return sanitizeArticleHtml(parsed);
  }, [markdown]);

  return (
    <div
      className="blog-markdown text-[16px] leading-8 text-[#454545] [&_a]:font-medium [&_a]:text-[#245C29] [&_a]:underline [&_a]:decoration-[#81DB86] [&_a]:decoration-2 [&_a]:underline-offset-4 [&_blockquote]:my-7 [&_blockquote]:rounded-r-2xl [&_blockquote]:border-l-4 [&_blockquote]:border-[#81DB86] [&_blockquote]:bg-[#F3FAF3] [&_blockquote]:px-5 [&_blockquote]:py-4 [&_code]:rounded-md [&_code]:bg-[#F1F1F1] [&_code]:px-1.5 [&_code]:py-0.5 [&_h2]:mb-4 [&_h2]:mt-12 [&_h2]:text-[26px] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-[#2F2F2F] [&_h3]:mb-3 [&_h3]:mt-8 [&_h3]:text-[20px] [&_h3]:font-semibold [&_h3]:text-[#2F2F2F] [&_hr]:my-10 [&_hr]:border-[#E5E5E5] [&_img]:my-8 [&_img]:max-h-[520px] [&_img]:w-full [&_img]:rounded-[22px] [&_img]:object-cover [&_li]:pl-1 [&_ol]:my-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:my-5 [&_pre]:my-7 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-[#202020] [&_pre]:p-5 [&_pre]:text-white [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_strong]:text-[#2F2F2F] [&_table]:my-8 [&_table]:w-full [&_table]:border-collapse [&_td]:border-b [&_td]:border-[#E5E5E5] [&_td]:px-3 [&_td]:py-3 [&_th]:border-b [&_th]:border-[#CFCFCF] [&_th]:px-3 [&_th]:py-3 [&_th]:text-left [&_th]:font-semibold [&_ul]:my-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
