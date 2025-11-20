// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CreateSessionModalProvider>
        <App />
      </CreateSessionModalProvider>
    </BrowserRouter>
  </React.StrictMode>
);
