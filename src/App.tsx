// src/App.tsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CreateSessionModalProvider } from "./hooks/useCreateSessionModal";
import { CreateSessionModal } from "./components/CreateSessionModal";

import SessionsPage from "./pages/SessionsPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";

export default function App() {
  return (
    <CreateSessionModalProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SessionsPage />} />
          <Route path="/sessions" element={<SessionsPage />} />

          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:id" element={<PublicProfilePage />} />
        </Routes>

        {/* глобальная модалка */}
        <CreateSessionModal />
      </BrowserRouter>
    </CreateSessionModalProvider>
  );
}
