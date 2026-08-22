import {
    createContext,
    useContext,
    useState,
    useRef,
    useEffect,
    useCallback,
    ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { withTimeout } from "../lib/promiseTimeout";
import { AUTH_PROFILE_READY_EVENT } from "../lib/authProfileEvents";

type Profile = {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
};

type AuthContextValue = {
    user: User | null;
    session: Session | null;
    profile: Profile | null;
    loading: boolean;
    reloadProfile: () => Promise<void>;
    adoptSession: (session: Session) => void;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function profileFromAuthMetadata(user: User): Profile {
    const metadata = user.user_metadata || {};
    const fullName = String(
        metadata.full_name || metadata.name || user.email || "User"
    ).trim();
    const avatarUrl = String(
        metadata.avatar_url || metadata.picture || ""
    ).trim();

    return {
        id: user.id,
        full_name: fullName || "User",
        avatar_url: avatarUrl || null,
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const authEventGenerationRef = useRef(0);
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const currentUserRef = useRef<User | null>(null);

    // Загружает профиль
    const loadProfile = useCallback(async (u: User | null) => {
        if (!u) {
            setProfile(null);
            return;
        }

        // Discord/Google already return a name and avatar in auth metadata.
        // Render those immediately while the durable profiles row catches up.
        const optimisticProfile = profileFromAuthMetadata(u);
        currentUserRef.current = u;
        setProfile((current) =>
            current?.id === u.id && current.avatar_url
                ? current
                : optimisticProfile
        );

        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .eq("id", u.id)
                .single();

            if (error) {
                console.warn("[Auth] Profile fetch warning:", error.message);
                return;
            }

            if (currentUserRef.current?.id === u.id) {
                setProfile(data as Profile);
            }
        } catch (err) {
            console.error("[Auth] loadProfile exception:", err);
        }
    }, []);

    const reloadProfile = useCallback(async () => {
        if (!user) return;
        await loadProfile(user);
    }, [user, loadProfile]);

    const adoptSession = useCallback((nextSession: Session) => {
        const nextUser = nextSession?.user ?? null;
        if (!nextUser?.id) return;

        authEventGenerationRef.current += 1;
        setSession(nextSession);
        setUser(nextUser);
        currentUserRef.current = nextUser;
        setLoading(false);
        void loadProfile(nextUser);
    }, [loadProfile]);

    // 🌟 ВОССТАНОВЛЕНИЕ СЕССИИ + LISTENER
    useEffect(() => {
        let active = true;
        const isAuthCallback =
            typeof window !== "undefined" &&
            window.location.pathname.replace(/\/$/, "") === "/auth/callback";

        const restoreSession = async () => {
            const restoreGeneration = authEventGenerationRef.current;

            try {
                const {
                    data: { session },
                } = await withTimeout(
                    supabase.auth.getSession(),
                    10_000,
                    "Timed out while restoring the auth session."
                );

                // onAuthStateChange may deliver a fresh SIGNED_IN session while
                // this slower restore is still pending. Never let the stale
                // restore overwrite that newer auth state with null.
                if (
                    !active ||
                    authEventGenerationRef.current !== restoreGeneration
                ) {
                    return;
                }

                if (session) {
                    adoptSession(session);
                } else {
                    setSession(null);
                    setUser(null);
                    currentUserRef.current = null;
                }
            } catch (error) {
                console.warn("[Auth] Session restore warning:", error);
            } finally {
                if (active) setLoading(false);
            }
        };

        // AuthCallback owns the OAuth code/session exchange. Starting another
        // getSession here can contend for Supabase's browser auth lock.
        if (!isAuthCallback) void restoreSession();

        // Auth listener
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(
            async (event, currentSession) => {
                if (!active) return;
                authEventGenerationRef.current += 1;

                // Supabase can emit a late INITIAL_SESSION with `null` while an
                // OAuth/PKCE SIGNED_IN event has already restored the user on a
                // slower browser. Treating every null payload as a logout made
                // the avatar flash briefly and then returned the header to the
                // signed-out state. Only an explicit SIGNED_OUT event is allowed
                // to clear an already authenticated client session.
                if (!currentSession && event !== "SIGNED_OUT") {
                    if (!currentUserRef.current) setLoading(false);
                    return;
                }

                if (currentSession) {
                    adoptSession(currentSession);
                } else {
                    setSession(null);
                    setUser(null);
                    currentUserRef.current = null;
                    setProfile(null);
                    setLoading(false);
                }
            }
        );

        const handleProfileReady = (event: Event) => {
            const profileEvent = event as CustomEvent<{ userId?: string }>;
            const currentUser = currentUserRef.current;
            if (currentUser?.id === profileEvent.detail?.userId) {
                void loadProfile(currentUser);
            }
        };

        window.addEventListener(AUTH_PROFILE_READY_EVENT, handleProfileReady);

        return () => {
            active = false;
            window.removeEventListener(AUTH_PROFILE_READY_EVENT, handleProfileReady);
            subscription.unsubscribe();
        };
    }, [adoptSession, loadProfile]);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
        currentUserRef.current = null;
        setLoading(false);
    }, []);

    return (
        <AuthContext.Provider
            value={{ user, session, profile, loading, reloadProfile, adoptSession, signOut }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
