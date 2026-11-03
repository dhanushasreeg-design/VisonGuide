import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// Register Service Worker for PWA installability and offline caching
if (
  typeof window !== "undefined" &&
  "serviceWorker" in navigator &&
  (window.location.protocol === "https:" || window.location.hostname === "localhost")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => {
        console.debug("ServiceWorker registration notice:", err);
      });
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
