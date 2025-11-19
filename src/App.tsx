// src/App.tsx
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import { SessionsPage } from "./pages/SessionsPage";
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";

// глобальная модалка
import { CreateSessionModal } from "./components/CreateSessionModal";

// zustand store (чтобы читать isOpen)
import { useCreateSessionModal } from "./hooks/useCreateSessionModal";

function App() {
  const modal = useCreateSessionModal();

  return (
    <Router>
      {/* Глобальная модалка — всегда смонтирована */}
      <CreateSessionModal
        isOpen={modal.isOpen}
        onClose={modal.close}
        onSessionCreated={modal.onCreated}
      />

      <Routes>
        {/* redirect root → /sessions */}
        <Route path="/" element={<Navigate to="/sessions" replace />} />

        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/room/:id" element={<RoomPage />} />

        {/* auth */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* profiles */}
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:id" element={<PublicProfilePage />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
