import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // 🔐 Проверяем авторизацию
  useEffect(() => {
    async function loadUser() {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setUser(data.user);
      } else {
        // если не залогинен — редирект на /login
        navigate("/login");
      }
      setLoading(false);
    }

    loadUser();
  }, [navigate]);

  // 💫 загрузка
  if (loading)
    return (
      <div className="flex items-center justify-center h-screen text-white bg-slate-900">
        <p>Loading...</p>
      </div>
    );

  // 👤 профиль
  return (
    <div className="min-h-screen bg-slate-900 text-white flex justify-center items-center py-20">
      <div className="bg-slate-800 rounded-2xl p-10 shadow-lg w-[480px] text-center space-y-6">
        <h1 className="text-3xl font-bold mb-2">Your Profile</h1>

        <div className="space-y-2">
          <p className="text-slate-300 text-lg">
            <span className="font-medium text-white">Email:</span> {user.email}
          </p>
          {user.user_metadata?.full_name && (
            <p className="text-slate-300 text-lg">
              <span className="font-medium text-white">Name:</span>{" "}
              {user.user_metadata.full_name}
            </p>
          )}
        </div>

        <button
          onClick={async () => {
            await supabase.auth.signOut();
            navigate("/login");
          }}
          className="mt-6 bg-red-600 px-6 py-2 rounded-lg font-medium hover:bg-red-700 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  );
}
