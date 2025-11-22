import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";

// Глобальные контексты
import { AuthProvider } from "./context/AuthContext";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CreateSessionModalProvider>
          <App />
        </CreateSessionModalProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
