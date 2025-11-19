import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";

import { CreateSessionModalProvider } from "./hooks/useCreateSessionModal";
import { CreateSessionModal } from "./components/CreateSessionModal";

export default function App() {
  return (
    <CreateSessionModalProvider>
      <Router>
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />

          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/room/:id" element={<RoomPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />

          <Route path="*" element={<Navigate to="/sessions" replace />} />
        </Routes>

        {/* ГЛОБАЛЬНАЯ МОДАЛКА */}
        <CreateSessionModal />
      </Router>
    </CreateSessionModalProvider>
  );
}
