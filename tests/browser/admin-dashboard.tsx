import "./admin-dashboard-setup";
import "./profile-page-auth";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../../src/context/AuthContext";
import { CreateSessionModalProvider } from "../../src/context/CreateSessionModalContext";
import AdminPage from "../../src/pages/AdminPage";
import "../../src/index.css";

// Dev-only preview of the admin dashboard with fixture data (not real users).
createRoot(document.getElementById("root")!).render(
  <MemoryRouter initialEntries={["/admin"]}>
    <AuthProvider>
      <CreateSessionModalProvider>
        <AdminPage />
      </CreateSessionModalProvider>
    </AuthProvider>
  </MemoryRouter>,
);
