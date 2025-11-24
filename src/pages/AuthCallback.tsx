import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export const AuthCallback = () => {
    const navigate = useNavigate();

    useEffect(() => {
        let mounted = true;

        const handleAuthRedirect = async () => {
            // 1. Сначала проверяем, не обработал ли Supabase сессию уже сам (это часто бывает быстрее рендера)
            const { data: { session } } = await supabase.auth.getSession();

            if (session && mounted) {
                // Сессия уже активна — мгновенный редирект
                navigate('/sessions', { replace: true });
                return;
            }

            // 2. Если сессии еще нет (Supabase в процессе обработки URL), слушаем событие входа
            const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
                if ((event === 'SIGNED_IN' || session) && mounted) {
                    navigate('/sessions', { replace: true });
                }
            });

            return () => {
                subscription.unsubscribe();
            };
        };

        handleAuthRedirect();

        // Предотвращаем утечку памяти, если компонент размонтируется
        return () => {
            mounted = false;
        };
    }, [navigate]);

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 text-gray-900">
            <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <h2 className="text-xl font-semibold mb-2">Завершаем вход...</h2>
                <p className="text-gray-500">Подождите, мы перенаправляем вас в приложение.</p>
            </div>
        </div>
    );
};

export default AuthCallback;