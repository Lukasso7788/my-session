import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { SessionsPage } from "./pages/SessionsPage";
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import ProfilePage from "./pages/ProfilePage";

function App() {
  return (
    <Router>
      <Routes>
        {/* перенаправляем с корня на /sessions */}
        <Route path="/" element={<Navigate to="/sessions" replace />} />

        {/* список всех сессий */}
        <Route path="/sessions" element={<SessionsPage />} />

        {/* страница комнаты (встроенный Daily iframe) */}
        <Route path="/room/:id" element={<RoomPage />} />

        {/* 🔐 страница входа / регистрации */}
        <Route path="/login" element={<LoginPage />} />

        {/* 👤 профиль пользователя */}
        <Route path="/profile" element={<ProfilePage />} />

        {/* fallback — если маршрут не найден */}
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
