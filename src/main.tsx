import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./index.css";
import "./free-flow-intro.css";

import { AuthProvider } from "./context/AuthContext";
import AnalyticsProvider from "./components/AnalyticsProvider";
import ProfileCompletionGate from "./components/ProfileCompletionGate";
import TermsAgreementGate from "./components/TermsAgreementGate";
import ProfileHoverLayer from "./components/ProfileHoverLayer";
import InAppBrowserMediaGate from "./components/InAppBrowserMediaGate";
import { initializeAnalytics } from "./lib/analytics";
import { installDynamicImportRecovery } from "./lib/dynamicImportRecovery";

const isStandaloneVectorizer = window.location.pathname.replace(/\/$/, "") === "/vectorizer";
const IconVectorizerPage = lazy(() => import("./pages/IconVectorizerPage"));

installDynamicImportRecovery();
initializeAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <InAppBrowserMediaGate>
      {isStandaloneVectorizer ? (
        <Suspense fallback={<div className="min-h-screen bg-[#fafafa]" />}>
          <IconVectorizerPage />
        </Suspense>
      ) : (
        <BrowserRouter basename="/">
          <AuthProvider>
            <AnalyticsProvider>
              <ProfileCompletionGate />
              <TermsAgreementGate />
              <App />
              <ProfileHoverLayer />
            </AnalyticsProvider>
          </AuthProvider>
        </BrowserRouter>
      )}
    </InAppBrowserMediaGate>
  </StrictMode>
);
