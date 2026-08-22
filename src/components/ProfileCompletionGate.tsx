import { useEffect, useMemo, useState } from "react";
import { Check, Clock3, UserRound } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loadEntitlementState } from "../lib/entitlements";
import { supabase } from "../lib/supabase";
import {
  formatTimeZoneLabel,
  getDetectedTimeZone,
  getSupportedTimeZones,
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

  const timeZones = useMemo(() => getSupportedTimeZones(timeZone), [timeZone]);
  const gateOpen = needsTimeZone || needsRealName;

  useEffect(() => {
    if (loading || !user?.id || AUTH_FLOW_ROUTE.test(pathname)) {
      setNeedsTimeZone(false);
      setNeedsRealName(false);
      return;
    }

    let cancelled = false;
    const metadata = user.user_metadata || {};
    const savedTimeZone = metadataString(
      metadata.timezone || metadata.time_zone || metadata.timeZone || metadata.tz,
    );
    const detectedTimeZone = getDetectedTimeZone();
    const currentName = String(
      profile?.full_name || metadata.full_name || metadata.name || "",
    ).trim();
    const timeZoneConfirmed = Boolean(metadata.timezone_confirmed_at);
    const realNameConfirmed = Boolean(metadata.real_name_confirmed_at);

    setTimeZone(
      isValidTimeZone(savedTimeZone) ? savedTimeZone : detectedTimeZone,
    );
    setRealName(currentName.includes("@") ? "" : currentName);
    setNeedsTimeZone(!timeZoneConfirmed);
    setMessage("");

    void Promise.all([
      loadEntitlementState(),
      supabase
        .from("profiles")
        .select("real_name_required")
        .eq("id", user.id)
        .maybeSingle(),
    ])
      .then(([state, requirementResult]) => {
        if (cancelled) return;
        const lifetimeCount = Number(state.lifetimeSessionsCount || 0);
        const adminRequiresRealName =
          requirementResult.data?.real_name_required === true;
        setNeedsRealName(
          adminRequiresRealName || (lifetimeCount >= 5 && !realNameConfirmed),
        );
      })
      .catch(() => {
        if (!cancelled) setNeedsRealName(false);
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
    user?.user_metadata,
  ]);

  useEffect(() => {
    if (!gateOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [gateOpen]);

  const confirmTimeZone = async () => {
    if (!user?.id || saving) return;
    if (!isValidTimeZone(timeZone)) {
      setMessage("Choose a valid timezone.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const now = new Date().toISOString();
      const { error: authError } = await supabase.auth.updateUser({
        data: {
          timezone: timeZone,
          timezone_confirmed_at: now,
        },
      });
      if (authError) throw authError;

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user?.id !== user.id) {
        throw new Error(
          "Your sign-in session was not saved. Please sign in once more.",
        );
      }
      adoptSession(sessionData.session);

      const { error: preferencesError } = await supabase
        .from("email_automation_preferences")
        .upsert(
          {
            user_id: user.id,
            timezone: timeZone,
            updated_at: now,
          },
          { onConflict: "user_id" },
        );

      if (preferencesError) {
        console.warn(
          "[profile-gate] email timezone sync failed:",
          preferencesError,
        );
      }

      localStorage.setItem(`mysession-timezone:${user.id}`, timeZone);
      setNeedsTimeZone(false);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save your timezone. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

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
        .eq("id", user.id);

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
          .eq("id", user.id);
      }
      if (profileUpdate.error) throw profileUpdate.error;

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

  if (!gateOpen || loading || !user || AUTH_FLOW_ROUTE.test(pathname)) {
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
            ? "We detected this from your device. MySession uses it for session times, reminders, and daily attendance."
            : "MySession works through trust and accountability. After five sessions, everyone continues using their real first name."}
        </p>

        {showingTimeZone ? (
          <label className="mt-6 block">
            <span className="text-[12px] font-semibold text-black/60">
              Your timezone
            </span>
            <select
              value={timeZone}
              onChange={(event) => setTimeZone(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-black/10 bg-[#F6F6F6] px-4 text-[14px] font-medium outline-none transition focus:border-[#2F2F2F]"
              autoFocus
            >
              {timeZones.map((zone) => (
                <option key={zone} value={zone}>
                  {formatTimeZoneLabel(zone)}
                </option>
              ))}
            </select>
            <span className="mt-2 flex items-center gap-1.5 text-[11px] text-black/42">
              <Check className="h-3.5 w-3.5" />
              Detected automatically — change it if needed.
            </span>
          </label>
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
            void (showingTimeZone ? confirmTimeZone() : confirmRealName())
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
