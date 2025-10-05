import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { SessionsPage } from './pages/SessionsPage';
import RoomPage from './pages/RoomPage';

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

        {/* fallback — если маршрут не найден */}
        <Route path="*" element={<Navigate to="/sessions" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
