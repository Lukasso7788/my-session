import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import IconVectorizerPage from "./pages/IconVectorizerPage";
import "./index.css";

import { AuthProvider } from "./context/AuthContext";
import AnalyticsProvider from "./components/AnalyticsProvider";
import ProfileCompletionGate from "./components/ProfileCompletionGate";
import InAppBrowserMediaGate from "./components/InAppBrowserMediaGate";
import { initializeAnalytics } from "./lib/analytics";

const isStandaloneVectorizer = window.location.pathname.replace(/\/$/, "") === "/vectorizer";

initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InAppBrowserMediaGate>
      {isStandaloneVectorizer ? (
        <IconVectorizerPage />
      ) : (
        <BrowserRouter basename="/">
          <AuthProvider>
            <AnalyticsProvider>
              <ProfileCompletionGate />
              <App />
            </AnalyticsProvider>
          </AuthProvider>
        </BrowserRouter>
      )}
    </InAppBrowserMediaGate>
  </StrictMode>
);
