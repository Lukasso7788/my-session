import { useEffect, useState } from "react";
import { ArrowUpRight, Check, FileText, Lock, ShieldCheck, Users } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";

// After signing up, people agree to the community rules and terms before they
// use MySession. The agreement is kept on the account (auth user metadata)
// with the time and the terms version, so it follows them across devices.

/** Bump when the rules or terms change in a way people should agree to again. */
export const TERMS_VERSION = "2026-10-23";
/** Accounts created before this agreed at signup under the old flow and are not asked. */
const TERMS_GATE_SINCE = Date.parse("2026-10-23T00:00:00Z");

// Sign-in screens and the pages the agreement links to stay readable.
const SKIP_ROUTE = /^\/(?:auth\/callback|login|register|update-password|terms|privacy|rules)\/?$/;

function acceptedKey(userId: string) {
  return `mysession:terms-accepted:${userId}`;
}

export function needsTermsAgreement(user: { id?: string; created_at?: string; user_metadata?: Record<string, unknown> } | null) {
  if (!user?.id) return false;
  if (user.user_metadata?.terms_accepted_at) return false;
  const createdAt = Date.parse(String(user.created_at || ""));
  return Number.isFinite(createdAt) && createdAt >= TERMS_GATE_SINCE;
}

export default function TermsAgreementGate() {
  const { pathname } = useLocation();
  const { user, loading, adoptSession, signOut } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [acceptedHere, setAcceptedHere] = useState(false);

  const userId = user?.id || "";
  useEffect(() => {
    setAgreed(false);
    setMessage("");
    let remembered = false;
    try {
      remembered = !!userId && localStorage.getItem(acceptedKey(userId)) === TERMS_VERSION;
    } catch {
      // Storage blocked: the account metadata still decides.
    }
    setAcceptedHere(remembered);
  }, [userId]);

  const open = !loading && !acceptedHere && !SKIP_ROUTE.test(pathname) && needsTermsAgreement(user as any);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open || !user) return null;

  const accept = async () => {
    if (!agreed || saving) return;
    setSaving(true);
    setMessage("");
    try {
      const now = new Date().toISOString();
      const { data, error } = await supabase.auth.updateUser({
        data: { terms_accepted_at: now, terms_version: TERMS_VERSION },
      });
      if (error) throw error;
      try {
        localStorage.setItem(acceptedKey(user.id), TERMS_VERSION);
      } catch {
        // Not remembered locally; the account metadata is the record.
      }
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session && sessionData.session.user.id === user.id) {
        adoptSession({ ...sessionData.session, user: data.user || sessionData.session.user });
      }
      setAcceptedHere(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save your agreement. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10090] flex items-center justify-center bg-black/45 px-4 py-6 font-inter backdrop-blur-[3px] animate-[fadeIn_220ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-agreement-title"
    >
      <div className="w-full max-w-[420px] rounded-[26px] bg-white p-5 text-[#2F2F2F] shadow-[0_26px_80px_rgba(0,0,0,0.22)] animate-[postSessionIn_300ms_cubic-bezier(0.22,1,0.36,1)] sm:p-6">
        {/* Icon and title in one row, the line under the title */}
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#2F2F2F] text-white shadow-[0_6px_16px_rgba(47,47,47,0.25)]">
            <ShieldCheck className="h-[22px] w-[22px]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="terms-agreement-title" className="text-[20px] font-bold leading-6 tracking-[-0.02em]">
              Before you start
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-black/55">
              A shared space for focused work, built on trust.
            </p>
          </div>
        </div>

        {/* The three documents, each opens in a new tab */}
        <ul className="mt-5 divide-y divide-black/[0.06] overflow-hidden rounded-[18px] border border-black/[0.08]">
          {[
            { href: "/rules", icon: <Users className="h-4 w-4" aria-hidden="true" />, title: "Community rules", hint: "How we treat each other" },
            { href: "/terms", icon: <FileText className="h-4 w-4" aria-hidden="true" />, title: "Terms of Service", hint: "Using MySession and your account" },
            { href: "/privacy", icon: <Lock className="h-4 w-4" aria-hidden="true" />, title: "Privacy Policy", hint: "What we collect and why" },
          ].map((doc) => (
            <li key={doc.href}>
              <a
                href={doc.href}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-[#F7F7F7]"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F1F1] text-[#2F2F2F]">
                  {doc.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-5">{doc.title}</span>
                  <span className="block truncate text-[12px] leading-4 text-black/50">{doc.hint}</span>
                </span>
                <ArrowUpRight
                  className="h-4 w-4 shrink-0 text-black/35 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[#2F2F2F]"
                  aria-hidden="true"
                />
              </a>
            </li>
          ))}
        </ul>

        {/* Agreement checkbox */}
        <label
          className={[
            "mt-3 flex cursor-pointer items-start gap-3 rounded-[16px] px-3.5 py-3 transition-colors",
            agreed ? "bg-[#F1F1F1]" : "hover:bg-[#F7F7F7]",
          ].join(" ")}
        >
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => {
              setAgreed(event.target.checked);
              setMessage("");
            }}
            className="peer sr-only"
            autoFocus
          />
          <span
            aria-hidden="true"
            className={[
              "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-[background-color,border-color,transform] duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-[#2F2F2F]/30",
              agreed ? "scale-105 border-[#2F2F2F] bg-[#2F2F2F] text-white" : "border-black/25 bg-white text-transparent",
            ].join(" ")}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          </span>
          <span className="text-[13px] leading-5 text-black/75">
            I agree to the Community rules and Terms of Service, and I have read the Privacy Policy.
          </span>
        </label>

        {message ? (
          <p className="mt-3 rounded-[14px] bg-[#FFF1F1] px-3.5 py-2.5 text-[12px] font-medium text-[#B42318]">{message}</p>
        ) : null}

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-11 rounded-[14px] px-4 text-[13px] font-semibold text-black/50 transition-colors hover:bg-[#F3F3F3] hover:text-black/75"
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => void accept()}
            disabled={!agreed || saving}
            className="ml-auto inline-flex h-11 flex-1 items-center justify-center rounded-[14px] bg-[#2F2F2F] px-5 text-[13.5px] font-semibold text-white transition-[background-color,opacity,transform] duration-150 hover:bg-black active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
          >
            {saving ? "Saving…" : "Agree and continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
