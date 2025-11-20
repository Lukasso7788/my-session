// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CreateSessionModalProvider } from "./hooks/useCreateSessionModal";
import { CreateSessionModal } from "./components/CreateSessionModal";

import SessionsPage from "./pages/SessionsPage";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";

export default function App() {
  return (
    <CreateSessionModalProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Routes>

        {/* ГЛОБАЛЬНАЯ МОДАЛКА — ВСЕГДА В КОНЦЕ */}
        <CreateSessionModal />
      </BrowserRouter>
    </CreateSessionModalProvider>
  );
}
