import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, UserRound } from "lucide-react";
import { useLocation } from "react-router-dom";
import TimeZonePicker from "./TimeZonePicker";
import { useAuth } from "../context/AuthContext";
import { loadEntitlementState } from "../lib/entitlements";
import { supabase } from "../lib/supabase";
import {
  chooseTimeZoneForFirstConfirmation,
  getBrowserTimeZone,
  getDetectedTimeZone,
  isValidTimeZone,
} from "../lib/timezones";

const AUTH_FLOW_ROUTE = /^\/(?:auth\/callback|login|register|update-password)\/?$/;

function metadataString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateRealName(value: string): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length < 2) return "Enter your real first name.";
  if (clean.length > 80) return "Keep your name under 80 characters.";
  if (clean.includes("@") || /^https?:/i.test(clean)) {
    return "Use your real name, not an email address or link.";
  }

  if (!/[\p{L}]/u.test(clean)) {
    return "Enter your real first name.";
  }

  return "";
}

export default function ProfileCompletionGate() {
  const { pathname, key: locationKey } = useLocation();
  const { user, profile, loading, reloadProfile, adoptSession } = useAuth();
  const [needsTimeZone, setNeedsTimeZone] = useState(false);
  const [needsRealName, setNeedsRealName] = useState(false);
  const [timeZone, setTimeZone] = useState(getDetectedTimeZone);
  const [realName, setRealName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [checkingTimeZone, setCheckingTimeZone] = useState(false);
  const saveInFlightRef = useRef(false);
  const selectionTouchedRef = useRef(false);
  const autoAttemptedRef = useRef<string | null>(null);
  const lastUserIdRef = useRef<string | null>(null);

  const gateOpen = needsTimeZone || needsRealName;

  const saveTimeZone = useCallback(async (zone: string) => {
    if (!user?.id || saveInFlightRef.current) return;
    if (!isValidTimeZone(zone)) {
      setMessage("Choose a valid timezone.");
      return;
    }

    saveInFlightRef.current = true;
    setSaving(true);
    setMessage("");

    try {
      const now = new Date().toISOString();
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ timezone: zone, updated_at: now })
        .eq("id", user.id);
      if (profileError) throw profileError;

      const { error: authError } = await supabase.auth.updateUser({
        data: { timezone: zone, timezone_confirmed_at: now },
      });
      if (authError) throw authError;

      await reloadProfile();
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user?.id !== user.id) {
        throw new Error("Your sign-in session was not saved. Please sign in once more.");
      }
      adoptSession(sessionData.session);

      const { error: preferencesError } = await supabase
        .from("email_automation_preferences")
        .upsert(
          { user_id: user.id, timezone: zone, updated_at: now },
          { onConflict: "user_id" },
        );
      if (preferencesError) {
        console.warn("[profile-gate] email timezone sync failed:", preferencesError);
      }

      try {
        localStorage.setItem(`mysession-timezone:${user.id}`, zone);
      } catch {
        // Browser storage can be disabled; the server-side choice is authoritative.
      }
      setNeedsTimeZone(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save your timezone. Please try again.",
      );
    } finally {
      saveInFlightRef.current = false;
      setSaving(false);
    }
  }, [user?.id, reloadProfile, adoptSession]);

  useEffect(() => {
    if (loading || !user?.id || AUTH_FLOW_ROUTE.test(pathname)) {
      setNeedsTimeZone(false);
      setNeedsRealName(false);
      setCheckingTimeZone(false);
      return;
    }

    let cancelled = false;
    const metadata = user.user_metadata || {};
    if (lastUserIdRef.current !== user.id) {
      lastUserIdRef.current = user.id;
      selectionTouchedRef.current = false;
      autoAttemptedRef.current = null;
    }
    const metadataZone = metadataString(
      metadata.timezone || metadata.time_zone || metadata.timeZone || metadata.tz,
    );
    const browserZone = getBrowserTimeZone();
    let rememberedZone = "";
    try {
      rememberedZone = localStorage.getItem(`mysession-timezone:${user.id}`) || "";
    } catch {
      // Private browsing may disable localStorage.
    }
    const initialZone = chooseTimeZoneForFirstConfirmation(
      metadataZone, profile?.timezone || "", rememberedZone, browserZone,
    );
    const hasExplicitZone = isValidTimeZone(metadataZone) ||
      isValidTimeZone(rememberedZone) ||
      (profile?.timezone !== "UTC" && isValidTimeZone(profile?.timezone || ""));
    const currentName = String(
      profile?.full_name || metadata.full_name || metadata.name || "",
    ).trim();
    const timeZoneConfirmed = Boolean(metadata.timezone_confirmed_at);
    const realNameConfirmed = Boolean(metadata.real_name_confirmed_at);

    if (!selectionTouchedRef.current) setTimeZone((browserZone || hasExplicitZone) ? initialZone : "");
    setRealName(currentName.includes("@") ? "" : currentName);
    setNeedsTimeZone(!timeZoneConfirmed);
    setCheckingTimeZone(!timeZoneConfirmed && Boolean(browserZone) && autoAttemptedRef.current !== user.id);
    void Promise.all([
      loadEntitlementState().catch(() => null),
      supabase
        .from("profiles")
        .select("real_name_required, timezone")
        .eq("id", user.id)
        .maybeSingle(),
    ])
      .then(async ([state, requirementResult]) => {
        if (cancelled) return;
        const storedTimeZone = requirementResult.data?.timezone || "";
        const selectedZone = chooseTimeZoneForFirstConfirmation(
          metadataZone, storedTimeZone, rememberedZone, browserZone,
        );
        const hasStoredZone = isValidTimeZone(metadataZone) ||
          isValidTimeZone(rememberedZone) ||
          (storedTimeZone !== "UTC" && isValidTimeZone(storedTimeZone));
        if (!selectionTouchedRef.current) {
          setTimeZone((browserZone || hasStoredZone) ? selectedZone : "");
        }
        const lifetimeCount = Number(state?.lifetimeSessionsCount || 0);
        const adminRequiresRealName =
          requirementResult.data?.real_name_required === true;
        setNeedsRealName(
          adminRequiresRealName || (lifetimeCount >= 5 && !realNameConfirmed),
        );
        if (
          !timeZoneConfirmed && browserZone && !selectionTouchedRef.current &&
          autoAttemptedRef.current !== user.id
        ) {
          autoAttemptedRef.current = user.id;
          await saveTimeZone(selectedZone);
        }
      })
      .catch(() => {
        if (!cancelled) setNeedsRealName(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingTimeZone(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    loading,
    locationKey,
    pathname,
    profile?.full_name,
    user?.id,
    profile?.timezone,
    user?.user_metadata,
    saveTimeZone,
  ]);

  useEffect(() => {
    if (!gateOpen || checkingTimeZone) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [gateOpen, checkingTimeZone]);

  const confirmRealName = async () => {
    if (!user?.id || saving) return;

    const cleanName = realName.trim().replace(/\s+/g, " ");
    const validationMessage = validateRealName(cleanName);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const now = new Date().toISOString();
      let profileUpdate = await supabase
        .from("profiles")
        .update({
          full_name: cleanName,
          real_name_required: false,
          real_name_required_at: null,
          real_name_required_by: null,
          updated_at: now,
        })
        .eq("id", user.id)
        .select("id")
        .maybeSingle();

      // Keep name confirmation working during the short deployment window
      // before the accompanying migration is applied.
      if (
        profileUpdate.error &&
        (profileUpdate.error.code === "PGRST204" ||
          profileUpdate.error.message.includes("real_name_required"))
      ) {
        profileUpdate = await supabase
          .from("profiles")
          .update({ full_name: cleanName, updated_at: now })
          .eq("id", user.id)
          .select("id")
          .maybeSingle();
      }
      if (profileUpdate.error) throw profileUpdate.error;
      if (!profileUpdate.data) {
        throw new Error("Your profile could not be updated. Please try again.");
      }

      const { error: authError } = await supabase.auth.updateUser({
        data: {
          full_name: cleanName,
          real_name_confirmed_at: now,
        },
      });
      if (authError) throw authError;

      setRealName(cleanName);
      setNeedsRealName(false);
      await reloadProfile();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save your name. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!gateOpen || loading || checkingTimeZone || !user || AUTH_FLOW_ROUTE.test(pathname)) {
    return null;
  }

  const showingTimeZone = needsTimeZone;

  return (
    <div
      className="fixed inset-0 z-[10080] flex items-center justify-center bg-black/45 px-4 py-6 font-inter backdrop-blur-[3px] animate-[fadeIn_220ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-completion-title"
    >
      <div className="w-full max-w-[470px] rounded-[28px] bg-white p-6 text-[#2F2F2F] shadow-[0_26px_90px_rgba(0,0,0,0.24)] animate-[postSessionIn_300ms_cubic-bezier(0.22,1,0.36,1)] sm:p-8">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F0F1F2] text-[#2F2F2F]">
          {showingTimeZone ? (
            <Clock3 className="h-6 w-6" aria-hidden="true" />
          ) : (
            <UserRound className="h-6 w-6" aria-hidden="true" />
          )}
        </div>

        <div className="mt-5 text-[11px] font-bold uppercase tracking-[0.16em] text-black/45">
          {showingTimeZone ? "Set your local time" : "Community identity"}
        </div>
        <h2
          id="profile-completion-title"
          className="mt-2 text-[26px] font-bold tracking-[-0.035em]"
        >
          {showingTimeZone ? "Confirm your timezone" : "Use your real name"}
        </h2>
        <p className="mt-2 text-[14px] leading-6 text-black/58">
          {showingTimeZone
            ? "Choose your local timezone for session times, reminders, and daily attendance. You can search by city, country, or region."
            : "MySession works through trust and accountability. After five sessions, everyone continues using their real first name."}
        </p>

        {showingTimeZone ? (
          <div className="mt-6">
            <label htmlFor="profile-timezone" className="text-[12px] font-semibold text-black/60">
              Your timezone
            </label>
            <TimeZonePicker
              id="profile-timezone"
              value={timeZone}
              onChange={(zone) => {
                selectionTouchedRef.current = true;
                setTimeZone(zone);
                setMessage("");
              }}
              className="mt-2"
              autoFocus
            />
            <span className="mt-2 block text-[11px] text-black/42">
              If your browser could not detect your timezone, choose it here.
            </span>
          </div>
        ) : (
          <label className="mt-6 block">
            <span className="text-[12px] font-semibold text-black/60">
              Real first name
            </span>
            <input
              value={realName}
              onChange={(event) => {
                setRealName(event.target.value);
                setMessage("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") void confirmRealName();
              }}
              className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-[#F6F6F6] px-4 text-[15px] outline-none transition placeholder:text-black/30 focus:border-[#2F2F2F]"
              placeholder="Your real first name"
              autoComplete="given-name"
              autoFocus
              maxLength={80}
            />
            <span className="mt-2 block text-[11px] leading-5 text-black/42">
              This is the name other focus partners will see.
            </span>
          </label>
        )}

        {message ? (
          <p className="mt-4 rounded-2xl bg-[#FFF1F1] px-4 py-3 text-[12px] font-medium text-[#B42318]">
            {message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() =>
            void (showingTimeZone ? saveTimeZone(timeZone) : confirmRealName())
          }
          disabled={saving}
          className="mt-6 inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[#2F2F2F] px-5 text-[14px] font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-55"
        >
          {saving
            ? "Saving…"
            : showingTimeZone
              ? "Confirm timezone"
              : "Save real name"}
        </button>
      </div>
    </div>
  );
}
