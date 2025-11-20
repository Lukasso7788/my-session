import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter as Router } from "react-router-dom";
import App from "./App";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CreateSessionModalProvider>
      <Router>
        <App />
      </Router>
    </CreateSessionModalProvider>
  </React.StrictMode>
);
