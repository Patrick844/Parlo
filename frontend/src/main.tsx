import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./index.css";
import { initAnalytics } from "./lib/analytics";

// Load PostHog (no-op unless VITE_POSTHOG_KEY is set).
initAnalytics();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
