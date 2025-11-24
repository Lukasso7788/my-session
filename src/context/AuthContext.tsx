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
                // Если профиля нет, просто пишем warning, но не ломаем приложение
                console.warn("[Auth] Profile fetch warning:", error.message);
                setProfile(null);
                return;
            }
            setProfile(data as Profile);
        } catch (err) {
            console.error("[Auth] loadProfile exception:", err);
            setProfile(null);
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
                    setSession(data.session);
                    setUser(data.session?.user ?? null);

                    if (data.session?.user) {
                        await loadProfile(data.session.user);
                    }
                }
            } catch (error) {
                console.error("[Auth] Init Error:", error);
            } finally {
                // ВАЖНО: Всегда выключаем загрузку, даже если профиль не нашелся
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

                // Сначала снимаем лоадер, чтобы UI не висел
                setLoading(false);

                // А потом грузим профиль
                if (currentUser) {
                    await loadProfile(currentUser);
                } else {
                    setProfile(null);
                }
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
        setLoading(false);
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