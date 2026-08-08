import { useMemo, useState } from "react";
import {
  BAN_PRESETS,
  createUserBan,
  formatBanEnd,
  getBanExpiresAtFromPreset,
  type BanPreset,
} from "../lib/bans";

type AdminUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type Props = {
  open: boolean;
  user: AdminUserRow | null;
  onClose: () => void;
  onBanned: () => void;
};

function getInitial(name: string) {
  return (String(name || "").trim()[0] || "U").toUpperCase();
}

export default function BanUserModal({ open, user, onClose, onBanned }: Props) {
  const [banMode, setBanMode] = useState<"regular" | "shadow">("regular");
  const [presetId, setPresetId] = useState("1d");
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const preset = useMemo<BanPreset>(() => {
    return BAN_PRESETS.find((p) => p.id === presetId) || BAN_PRESETS[3];
  }, [presetId]);

  const expiresAt = useMemo(() => {
    return getBanExpiresAtFromPreset(preset, customExpiresAt);
  }, [preset, customExpiresAt]);

  if (!open || !user) return null;

  const displayName = String(user.full_name || user.email || user.id || "User");

  const submit = async () => {
    try {
      setSaving(true);
      setError("");

      const cleanReason = reason.trim();
      if (!cleanReason) {
        setError(
          banMode === "shadow"
            ? "A private moderation reason is required."
            : "Reason is required. The banned user will see it.",
        );
        return;
      }

      if (expiresAt === "") {
        setError("Choose a valid ban duration or custom end date.");
        return;
      }

      await createUserBan({
        bannedUserId: user.id,
        reason: cleanReason,
        internalNotes,
        expiresAt,
        shadowBan: banMode === "shadow",
      });

      setReason("");
      setInternalNotes("");
      setPresetId("1d");
      setCustomExpiresAt("");
      setBanMode("regular");

      onBanned();
      onClose();
    } catch (e: any) {
      console.error("[ban-modal] failed:", e);
      setError(String(e?.message || e || "Failed to create ban."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center px-4 py-6">
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative w-full max-w-[760px] max-h-[calc(100dvh-32px)] overflow-auto rounded-[28px] bg-white p-6 text-[#2F2F2F] shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-red-600">
              Admin action
            </div>
            <h2 className="mt-2 text-[26px] font-bold">
              {banMode === "shadow" ? "Shadow ban user" : "Ban user"}
            </h2>
            <p className="mt-2 max-w-[620px] text-[14px] leading-6 text-[#666]">
              {banMode === "shadow"
                ? "Silently revoke access. The user will see a neutral loading screen instead of a ban notice."
                : "Create a temporary or permanent ban. The reason is required and will be shown to the user."}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-10 w-10 rounded-full border border-black/10 bg-black/[0.03] text-[20px] hover:bg-black/[0.07]"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-black/10 bg-gray-50 p-4">
          <div className="h-12 w-12 overflow-hidden rounded-full bg-gray-200">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[18px] font-bold">
                {getInitial(displayName)}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold">{displayName}</div>
            <div className="truncate text-[12px] text-[#666]">{user.id}</div>
            {user.email ? <div className="truncate text-[12px] text-[#666]">{user.email}</div> : null}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-[14px] font-semibold">Restriction type</div>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-black/[0.04] p-1.5">
            {(["regular", "shadow"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setBanMode(mode)}
                className={[
                  "rounded-xl px-3 py-2.5 text-[13px] font-semibold transition",
                  banMode === mode
                    ? "bg-[#2F2F2F] text-white"
                    : "text-[#555] hover:bg-white/80",
                ].join(" ")}
              >
                {mode === "shadow" ? "Shadow ban" : "Regular ban"}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-[14px] font-semibold">Duration</div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BAN_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPresetId(p.id)}
                className={[
                  "rounded-2xl border px-3 py-2 text-[13px] font-semibold transition",
                  presetId === p.id
                    ? "border-[#2F2F2F] bg-[#2F2F2F] text-white"
                    : "border-black/10 bg-white text-[#2F2F2F] hover:bg-black/[0.04]",
                ].join(" ")}
              >
                {p.label}
              </button>
            ))}
          </div>

          {presetId === "custom" ? (
            <div className="mt-4">
              <label className="text-[13px] font-semibold text-[#444]">
                Custom ban end
              </label>
              <input
                type="datetime-local"
                value={customExpiresAt}
                onChange={(e) => setCustomExpiresAt(e.target.value)}
                className="mt-2 w-full rounded-2xl border border-black/10 px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
              />
            </div>
          ) : null}

          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] leading-5 text-amber-900">
            Ban ends: <span className="font-bold">{formatBanEnd(expiresAt || null)}</span>
          </div>
        </div>

        <div className="mt-6">
          <label className="text-[14px] font-semibold">
            {banMode === "shadow" ? "Private moderation reason" : "Reason shown to user"}{" "}
            <span className="text-red-600">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-2 min-h-[110px] w-full resize-none rounded-2xl border border-black/10 px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
            placeholder={
              banMode === "shadow"
                ? "Example: Coordinated abuse or ban evasion."
                : "Example: Repeatedly disrupting focus sessions after warnings."
            }
          />
        </div>

        <div className="mt-4">
          <label className="text-[14px] font-semibold">Internal notes</label>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            className="mt-2 min-h-[80px] w-full resize-none rounded-2xl border border-black/10 px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
            placeholder="Optional private admin notes."
          />
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/10 bg-white px-5 py-3 text-[14px] font-semibold hover:bg-black/[0.04]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className="rounded-full bg-red-600 px-5 py-3 text-[14px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {saving
              ? "Saving..."
              : banMode === "shadow"
                ? "Create shadow ban"
                : "Create ban"}
          </button>
        </div>
      </div>
    </div>
  );
}
