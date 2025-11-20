// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { CreateSessionModalProvider } from "./context/CreateSessionModalContext";

console.log("%cMAIN: render root", "color: #0a0");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {console.log("%cMAIN: before BrowserRouter", "color: #0a0")}
    <BrowserRouter>
      {console.log("%cMAIN: before CreateSessionModalProvider", "color: #0a0")}
      <CreateSessionModalProvider>
        {console.log("%cMAIN: before App render", "color: #0a0")}
        <App />
      </CreateSessionModalProvider>
    </BrowserRouter>
  </React.StrictMode>
);
