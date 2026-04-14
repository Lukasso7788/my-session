import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const AuthCallback = () => {
    const navigate = useNavigate();

    useEffect(() => {
        let mounted = true;

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (!mounted) return;

            if (event === 'SIGNED_IN' || session) {
                navigate('/sessions', { replace: true });
            }
        });

        const handleAuthRedirect = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!mounted) return;

            if (session) {
                navigate('/sessions', { replace: true });
                return;
            }

            // fallback: если по какой-то причине сессия не появилась сразу,
            // через небольшую паузу ещё раз проверим
            setTimeout(async () => {
                if (!mounted) return;

                const {
                    data: { session: retrySession },
                } = await supabase.auth.getSession();

                if (!mounted) return;

                if (retrySession) {
                    navigate('/sessions', { replace: true });
                } else {
                    navigate('/login', { replace: true });
                }
            }, 2500);
        };

        handleAuthRedirect();

        return () => {
            mounted = false;
            subscription.unsubscribe();
        };
    }, [navigate]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 text-gray-900">
            <div className="text-center">
                <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
                <h2 className="mb-2 text-xl font-semibold">Завершаем вход...</h2>
                <p className="text-gray-500">Подождите, мы перенаправляем вас в приложение.</p>
            </div>
        </div>
    );
};

export default AuthCallback;