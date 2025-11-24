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

    // Функция загрузки профиля (оставили твою логику)
    const loadProfile = useCallback(async (u: User | null) => {
        // console.log("[Auth] loadProfile for:", u?.id);

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
                // Если профиля нет, не критично, просто null
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

                if (error) throw error;

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
                // ВАЖНО: Выключаем загрузку ВСЕГДА, что бы ни случилось
                if (mounted) {
                    setLoading(false);
                    console.log("[Auth] INIT done → loading = false");
                }
            }
        };

        initSession();

        // 2. Слушаем изменения (Login, Logout, Auto-refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, currentSession) => {
                console.log("[Auth] StateChange:", event);

                if (!mounted) return;

                const currentUser = currentSession?.user ?? null;

                setSession(currentSession);
                setUser(currentUser);

                // Если вошли - грузим профиль
                if (currentUser) {
                    // Оптимизация: не грузим профиль повторно, если ID тот же (по желанию, но пока оставим как есть для надежности)
                    await loadProfile(currentUser);
                } else {
                    setProfile(null);
                }

                // Гарантия снятия лоадера при событиях (например, после OAuth редиректа)
                setLoading(false);
            }
        );

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [loadProfile]);

    const signOut = useCallback(async () => {
        console.log("[Auth] signOut()");
        await supabase.auth.signOut();
        setUser(null);
        setSession(null);
        setProfile(null);
        // Не ставим setLoading(true), чтобы интерфейс не мигал
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