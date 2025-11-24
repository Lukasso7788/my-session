import { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;

        // 1. Функция инициализации сессии при загрузке приложения
        const initSession = async () => {
            try {
                // Пытаемся достать сессию из localStorage
                const { data: { session: initialSession }, error } = await supabase.auth.getSession();

                if (error) throw error;

                if (mounted) {
                    if (initialSession) {
                        setSession(initialSession);
                        setUser(initialSession.user);
                    }
                }
            } catch (error) {
                console.error('Ошибка инициализации сессии:', error);
            } finally {
                // САМОЕ ВАЖНОЕ: В любом случае (нашли сессию или нет) убираем загрузку
                if (mounted) {
                    setLoading(false);
                }
            }
        };

        initSession();

        // 2. Подписка на изменения состояния (вход, выход, авто-обновление токена)
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (mounted) {
                setSession(session);
                setUser(session?.user ?? null);
                // Дублируем снятие лоадера здесь для надежности
                setLoading(false);
            }
        });

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, []);

    const value = {
        session,
        user,
        loading,
        signOut: async () => {
            await supabase.auth.signOut();
            setUser(null);
            setSession(null);
            setLoading(false);
        },
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Хук для удобного использования
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};