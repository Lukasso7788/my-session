import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
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

  const linkCls = "font-semibold text-[#2F2F2F] underline underline-offset-2 hover:text-black";

  return (
    <div
      className="fixed inset-0 z-[10090] flex items-center justify-center bg-black/45 px-4 py-6 font-inter backdrop-blur-[3px] animate-[fadeIn_220ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-agreement-title"
    >
      <div className="w-full max-w-[470px] rounded-[28px] bg-white p-6 text-[#2F2F2F] shadow-[0_26px_90px_rgba(0,0,0,0.24)] animate-[postSessionIn_300ms_cubic-bezier(0.22,1,0.36,1)] sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F0F1F2] text-[#2F2F2F]">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>

        <h2 id="terms-agreement-title" className="mt-5 text-[26px] font-bold tracking-[-0.035em]">
          Before you start
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-black/58">
          MySession is a shared space for focused work, built on trust and respect. Please read and agree to how it works.
        </p>

        <ul className="mt-5 space-y-2 rounded-2xl bg-[#F6F6F6] p-4 text-[13px] leading-5 text-black/70">
          <li>
            <a href="/rules" target="_blank" rel="noreferrer" className={linkCls}>Community rules</a>: how we treat each other in sessions and chat
          </li>
          <li>
            <a href="/terms" target="_blank" rel="noreferrer" className={linkCls}>Terms of Service</a>: using MySession and your account
          </li>
          <li>
            <a href="/privacy" target="_blank" rel="noreferrer" className={linkCls}>Privacy Policy</a>: what we collect and why
          </li>
        </ul>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl border border-black/10 p-4 transition-colors hover:bg-[#FAFAFA] has-[:checked]:border-[#2F2F2F]">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(event) => {
              setAgreed(event.target.checked);
              setMessage("");
            }}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded-md accent-[#2F2F2F]"
            autoFocus
          />
          <span className="text-[13.5px] leading-5">
            I agree to the MySession Community rules and Terms of Service, and I have read the Privacy Policy.
          </span>
        </label>

        {message ? (
          <p className="mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-[12px] font-medium text-[#B42318]">{message}</p>
        ) : null}

        <button
          type="button"
          onClick={() => void accept()}
          disabled={!agreed || saving}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#2F2F2F] px-5 text-[14px] font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Agree and continue"}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 w-full text-center text-[12px] font-medium text-black/45 transition hover:text-black/70"
        >
          I don't agree, sign me out
        </button>
      </div>
    </div>
  );
}
