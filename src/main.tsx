import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import IconVectorizerPage from "./pages/IconVectorizerPage";
import "./index.css";

import { AuthProvider } from "./context/AuthContext";

const isStandaloneVectorizer = window.location.pathname.replace(/\/$/, "") === "/vectorizer";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isStandaloneVectorizer ? (
      <IconVectorizerPage />
    ) : (
      <BrowserRouter basename="/">
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </StrictMode>
);
