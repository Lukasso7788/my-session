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
            // console.log("[Auth] Fetching profile for:", u.id);
            const { data, error } = await supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .eq("id", u.id)
                .single();

            if (error) {
                // Это не критическая ошибка, просто профиля пока нет
                console.warn("[Auth] Profile missing/error (non-critical):", error.message);
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
            console.log("[Auth] INIT start with Timeout Race");

            // 1. Создаем таймер на 4 секунды (предохранитель)
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), 4000)
            );

            // 2. Реальный запрос к Supabase
            const sessionPromise = supabase.auth.getSession();

            try {
                // 3. Гонка: кто быстрее — ответ сервера или таймер?
                const { data, error } = await Promise.race([sessionPromise, timeoutPromise]) as any;

                if (error) throw error;

                if (mounted) {
                    setSession(data.session);
                    setUser(data.session?.user ?? null);

                    if (data.session?.user) {
                        // Запускаем загрузку профиля, но НЕ ждем её (no await), 
                        // чтобы интерфейс отрисовался сразу, не блокируя UI
                        loadProfile(data.session.user).catch(e => console.error("Profile load error", e));
                    }
                }
            } catch (error) {
                console.error("[Auth] Init Error or Timeout:", error);
            } finally {
                // 4. ГАРАНТИЯ: Снимаем лоадер ВСЕГДА
                if (mounted) {
                    console.log("[Auth] Force stopping loading spinner");
                    setLoading(false);
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

                // ВАЖНО: Снимаем лоадер СРАЗУ, не дожидаясь профиля
                setLoading(false);

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