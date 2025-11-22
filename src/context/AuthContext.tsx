import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

type Profile = {
    id: string;
    full_name: string | null;
    avatar_url: string | null;
};

type AuthContextValue = {
    user: User | null;
    profile: Profile | null;
    loading: boolean;
    reloadProfile: () => Promise<void>;
    signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async (u: User | null) => {
        console.log("[Auth] loadProfile for:", u?.id);

        if (!u) {
            setProfile(null);
            return;
        }

        const { data, error } = await supabase
            .from("profiles")
            .select("id, full_name, avatar_url")
            .eq("id", u.id)
            .single();

        if (error) {
            console.error("[Auth] loadProfile error:", error);
            setProfile(null);
            return;
        }

        setProfile(data as Profile);
    }, []);

    const reloadProfile = useCallback(async () => {
        if (!user) return;
        await loadProfile(user);
    }, [user, loadProfile]);

    useEffect(() => {
        let mounted = true;

        const init = async () => {
            console.log("[Auth] INIT start");

            const { data, error } = await supabase.auth.getSession();

            if (error) console.error("[Auth] getSession error:", error);
            console.log("[Auth] getSession result:", data);

            if (!mounted) return;

            const currentUser = data.session?.user ?? null;
            setUser(currentUser);

            if (currentUser) {
                await loadProfile(currentUser);
            }

            setLoading(false);
            console.log("[Auth] INIT done → loading = false");
        };

        init();

        const { data: listener } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                console.log("[Auth] StateChange:", event, session);

                if (!mounted) return;
                const currentUser = session?.user ?? null;

                setUser(currentUser);

                if (currentUser) {
                    await loadProfile(currentUser);
                } else {
                    setProfile(null);
                }
            }
        );

        return () => {
            mounted = false;
            listener.subscription.unsubscribe();
        };
    }, [loadProfile]);

    const signOut = useCallback(async () => {
        console.log("[Auth] signOut()");
        await supabase.auth.signOut();
        setUser(null);
        setProfile(null);
    }, []);

    return (
        <AuthContext.Provider
            value={{ user, profile, loading, reloadProfile, signOut }}
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
