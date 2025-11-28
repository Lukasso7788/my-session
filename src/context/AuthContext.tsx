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

    // Загружает профиль
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

    // 🌟 ВОССТАНОВЛЕНИЕ СЕССИИ + LISTENER
    useEffect(() => {
        let active = true;

        const restoreSession = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!active) return;

            setSession(session);
            setUser(session?.user ?? null);

            if (session?.user) {
                loadProfile(session.user); // без await — чтобы не блокировать UI
            }

            setLoading(false);
        };

        restoreSession();

        // Auth listener
        const { data: subscription } = supabase.auth.onAuthStateChange(
            async (event, currentSession) => {
                if (!active) return;

                const currentUser = currentSession?.user ?? null;

                setSession(currentSession);
                setUser(currentUser);

                if (currentUser) {
                    loadProfile(currentUser); // без await — listener не блокируется
                } else {
                    setProfile(null);
                }

                setLoading(false);
            }
        );

        return () => {
            active = false;
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
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
