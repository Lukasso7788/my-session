import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  formatBanEnd,
  isCurrentUserAdmin,
  listActiveBans,
  revokeUserBan,
  searchAdminUsers,
  type ActiveBan,
} from "../lib/bans";
import BanUserModal from "../components/BanUserModal";

type AdminUserRow = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
};

function getInitial(name: string) {
  return (String(name || "").trim()[0] || "U").toUpperCase();
}

export default function AdminPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);

  const [activeBans, setActiveBans] = useState<ActiveBan[]>([]);
  const [bansLoading, setBansLoading] = useState(false);
  const [error, setError] = useState("");

  const cleanQuery = useMemo(() => query.trim(), [query]);

  const loadBans = async () => {
    try {
      setBansLoading(true);
      const bans = await listActiveBans();
      setActiveBans(bans);
    } catch (e: any) {
      console.error("[admin] load bans failed:", e);
      setError(String(e?.message || e || "Failed to load bans."));
    } finally {
      setBansLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError("");

        const { data } = await supabase.auth.getSession();
        if (!data.session?.user) {
          navigate("/login", { replace: true });
          return;
        }

        const ok = await isCurrentUserAdmin();

        if (!cancelled) {
          setIsAdmin(ok);
          if (ok) await loadBans();
        }
      } catch (e: any) {
        console.error("[admin] init failed:", e);
        if (!cancelled) setError(String(e?.message || e || "Admin load failed."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const runSearch = async () => {
    if (!cleanQuery) {
      setUsers([]);
      return;
    }

    try {
      setSearching(true);
      setError("");
      const rows = await searchAdminUsers(cleanQuery);
      setUsers(rows as AdminUserRow[]);
    } catch (e: any) {
      console.error("[admin] search failed:", e);
      setError(String(e?.message || e || "Search failed."));
    } finally {
      setSearching(false);
    }
  };

  const revoke = async (ban: ActiveBan) => {
    const ok = window.confirm("Revoke this ban?");
    if (!ok) return;

    try {
      await revokeUserBan({ banId: ban.id, reason: "Revoked from admin page." });
      await loadBans();
    } catch (e: any) {
      console.error("[admin] revoke failed:", e);
      setError(String(e?.message || e || "Failed to revoke ban."));
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-b-2 border-black" />
        </div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-white px-6 py-16 font-inter text-[#2F2F2F]">
        <div className="mx-auto max-w-2xl rounded-[28px] border border-black/10 bg-white p-8 text-center shadow-sm">
          <div className="text-[26px] font-bold">Admin access required</div>
          <p className="mt-3 text-[14px] leading-6 text-[#666]">
            Your account is not listed in admin_users.
          </p>
          <button
            type="button"
            onClick={() => navigate("/sessions")}
            className="mt-6 rounded-full bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white"
          >
            Back to sessions
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-white px-6 py-10 font-inter text-[#2F2F2F]">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#666]">
              MySession Admin
            </div>
            <h1 className="mt-2 text-[34px] font-bold">Moderation</h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#666]">
              Search users, create temporary bans with required user-facing reasons, and revoke active bans.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate("/sessions")}
            className="rounded-full border border-[#2F2F2F] px-5 py-2.5 text-[14px] font-semibold hover:bg-[#2F2F2F] hover:text-white"
          >
            Back to sessions
          </button>
        </div>

        {error ? (
          <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        ) : null}

        <section className="mt-8 rounded-[28px] border border-black/10 bg-gray-50 p-5">
          <h2 className="text-[20px] font-bold">Ban a participant</h2>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
              placeholder="Search by name, email, or user id"
              className="min-w-0 flex-1 rounded-2xl border border-black/10 bg-white px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-black/15"
            />
            <button
              type="button"
              disabled={searching || !cleanQuery}
              onClick={() => void runSearch()}
              className="rounded-2xl bg-[#2F2F2F] px-5 py-3 text-[14px] font-semibold text-white disabled:opacity-60"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {users.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-white px-4 py-4 text-[14px] text-[#666]">
                No users selected yet. Search by full name, email, or UUID.
              </div>
            ) : (
              users.map((u) => {
                const display = String(u.full_name || u.email || u.id || "User");

                return (
                  <div
                    key={u.id}
                    className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full bg-gray-200">
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold">
                            {getInitial(display)}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold">{display}</div>
                        <div className="truncate text-[12px] text-[#666]">{u.id}</div>
                        {u.email ? <div className="truncate text-[12px] text-[#666]">{u.email}</div> : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedUser(u);
                        setBanModalOpen(true);
                      }}
                      className="rounded-full bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700"
                    >
                      Ban user
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="mt-8 rounded-[28px] border border-black/10 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[20px] font-bold">Active bans</h2>
            <button
              type="button"
              onClick={() => void loadBans()}
              className="rounded-full border border-black/10 px-4 py-2 text-[13px] font-semibold hover:bg-black/[0.04]"
            >
              {bansLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-5 space-y-3">
            {activeBans.length === 0 ? (
              <div className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-4 text-[14px] text-[#666]">
                No active bans.
              </div>
            ) : (
              activeBans.map((ban) => (
                <div
                  key={ban.id}
                  className="rounded-2xl border border-black/10 bg-gray-50 px-4 py-3"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold text-[#2F2F2F]">
                        User: {ban.banned_user_id}
                      </div>
                      <div className="mt-1 text-[13px] leading-5 text-[#666]">
                        {ban.reason}
                      </div>
                      <div className="mt-2 text-[12px] text-[#777]">
                        Ends: <span className="font-semibold">{formatBanEnd(ban.expires_at || null)}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void revoke(ban)}
                      className="rounded-full border border-red-600 px-4 py-2 text-[13px] font-semibold text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <BanUserModal
        open={banModalOpen}
        user={selectedUser}
        onClose={() => setBanModalOpen(false)}
        onBanned={() => {
          void loadBans();
        }}
      />
    </main>
  );
}
