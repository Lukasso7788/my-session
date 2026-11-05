import { useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { HOST_LINK_MAX, hostLinkProblem, normalizeHostLink } from "../lib/hostLink";

export type HostLinkStatus = "empty" | "checking" | "available" | "yours" | "taken" | "invalid" | "unknown";

function siteOrigin() {
  return typeof window !== "undefined" && window.location?.origin ? window.location.origin : "https://mysession.club";
}

export function hostLinkUrl(slug: string) {
  return `${siteOrigin()}/${slug}`;
}

/** Whether nobody else (no session, page or host) uses this address. */
export async function checkHostLink(slug: string, userId: string): Promise<HostLinkStatus> {
  if (!slug) return "empty";
  if (hostLinkProblem(slug)) return "invalid";
  const { data, error } = await supabase
    .from("public_url_slugs")
    .select("owner_type, owner_id")
    .eq("slug", slug)
    .maybeSingle();
  if (error) return "unknown";
  if (!data) return "available";
  return (data as any).owner_type === "profile" && (data as any).owner_id === userId ? "yours" : "taken";
}

/** Profile editor field: mysession.club/<link>, checked while typing. */
export function HostLinkField({
  value,
  onChange,
  userId,
  disabled = false,
  onStatus,
}: {
  value: string;
  onChange: (slug: string) => void;
  userId: string;
  disabled?: boolean;
  onStatus?: (status: HostLinkStatus) => void;
}) {
  const [status, setStatus] = useState<HostLinkStatus>("empty");
  const problem = hostLinkProblem(value);

  useEffect(() => {
    if (!value) {
      setStatus("empty");
      return;
    }
    if (problem) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkHostLink(value, userId).then((next) => {
        if (!cancelled) setStatus(next);
      });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [value, problem, userId]);

  useEffect(() => {
    onStatus?.(status);
  }, [status, onStatus]);

  const host = siteOrigin().replace(/^https?:\/\//, "");
  const message =
    status === "invalid" ? problem
      : status === "taken" ? "This link is taken. Try another one."
        : status === "checking" ? "Checking…"
          : status === "available" ? "Available"
            : status === "yours" ? "This is your link"
              : status === "unknown" ? "Couldn't check right now; it will be checked when you save."
                : "Optional. People who open it land in the group session you're hosting now, or your next one.";
  const tone = status === "taken" || status === "invalid" ? "text-[#C2410C]" : status === "available" || status === "yours" ? "text-[#2F8F35]" : "text-gray-500";

  return (
    <div>
      <div className="mt-2 flex h-12 items-center overflow-hidden rounded-xl border border-gray-300 focus-within:ring-2 focus-within:ring-black">
        <span className="flex h-full shrink-0 items-center gap-1.5 border-r border-gray-200 bg-gray-50 px-3 text-[14px] text-gray-500">
          <Link2 className="h-4 w-4" aria-hidden="true" />
          {host}/
        </span>
        <input
          id="profile-edit-host-link"
          value={value}
          onChange={(event) => onChange(normalizeHostLink(event.target.value))}
          maxLength={HOST_LINK_MAX}
          placeholder="your-name"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-[15px] outline-none"
        />
      </div>
      <p className={`mt-2 text-xs ${tone}`} aria-live="polite">{message}</p>
    </div>
  );
}

/** Own profile, view mode: the saved link with a copy button. */
export function HostLinkBadge({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = hostLinkUrl(slug);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
      <span className="shrink-0 text-gray-500">Your session link</span>
      <a href={url} target="_blank" rel="noopener noreferrer" className="truncate font-semibold text-[#2F2F2F] underline decoration-black/20 underline-offset-2 hover:decoration-black">
        {url.replace(/^https?:\/\//, "")}
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
        aria-label="Copy session link"
        title={copied ? "Copied" : "Copy link"}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[#2F2F2F] transition hover:bg-gray-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-[#2F8F35]" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </span>
  );
}
