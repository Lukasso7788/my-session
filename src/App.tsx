import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { SessionsPage } from './pages/SessionsPage';
import RoomPage from './pages/RoomPage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SessionsPage />} />
        <Route path="/room/:id" element={<RoomPage />} />
      </Routes>
    </Router>
  );
}

export default App;
