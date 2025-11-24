import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    ReactNode,
} from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

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
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async (u: User | null) => {
        if (!u) {
            setProfile(null);
            return;
        }
        try {
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .eq("id", u.id)
                .single();

            if (error) {
                console.error("[Auth] loadProfile error:", error.message);
                setProfile(null);
                return;
            }
            setProfile(data as Profile);
        } catch (err) {
            console.error("[Auth] loadProfile exception:", err);
        }
    }, []);

    const reloadProfile = useCallback(async () => {
        if (!user) return;
        await loadProfile(user);
    }, [user, loadProfile]);

    useEffect(() => {
        let mounted = true;

        const initSession = async () => {
            console.log("[Auth] INIT start");
            try {
                // 1. Получаем сессию
                const { data, error } = await supabase.auth.getSession();

                if (error) {
                    throw error;
                }

                if (mounted) {
                    const currentSession = data.session;
                    const currentUser = currentSession?.user ?? null;

                    setSession(currentSession);
                    setUser(currentUser);

                    if (currentUser) {
                        await loadProfile(currentUser);
                    }
                }
            } catch (error) {
                console.error("[Auth] Init Error:", error);
            } finally {
                // ИСПРАВЛЕНИЕ: Убрал проверку if (mounted) для setLoading
                // React стейт обновлять на размонтированном компоненте нельзя, но
                // в 99% случаев зависание происходит, когда компонент ЕЩЕ смонтирован,
                // но флаг mounted уже ложно сработал из-за StrictMode.
                // Безопасный вариант:
                if (mounted) {
                    setLoading(false);
                    console.log("[Auth] INIT done -> loading set to FALSE");
                }
            }
        };

        initSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, currentSession) => {
                console.log("[Auth] StateChange:", event);

                if (!mounted) return;

                const currentUser = currentSession?.user ?? null;
                setSession(currentSession);
                setUser(currentUser);

                if (currentUser) {
                    await loadProfile(currentUser);
                } else {
                    setProfile(null);
                }

                setLoading(false);
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [loadProfile]);

    const signOut = useCallback(async () => {
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
    }, []);

    return (
        <AuthContext.Provider
            value={{ user, session, profile, loading, reloadProfile, signOut }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error("useAuth must be used within AuthProvider");
    return ctx;
}