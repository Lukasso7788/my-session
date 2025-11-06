import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { SessionsPage } from "./pages/SessionsPage";
import RoomPage from "./pages/RoomPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import ProfilePage from "./pages/ProfilePage";
import PublicProfilePage from "./pages/PublicProfilePage";

function App() {
  return (
    <Router>
      <Routes>
        {/* redirect root → /sessions */}
        <Route path="/" element={<Navigate to="/sessions" replace />} />

        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/room/:id" element={<RoomPage />} />

        {/* ✅ manual auth pages */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/:id" element={<PublicProfilePage />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
