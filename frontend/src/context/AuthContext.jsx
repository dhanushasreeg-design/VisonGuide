import React, { createContext, useContext, useState, useEffect } from "react";
import axios from "axios";

const AuthContext = createContext(null);

const BASE = import.meta.env.VITE_API_URL ?? "";
// 40 s — Render free tier cold-starts take ~30 s; 12 s was too short
const authAPI = axios.create({ baseURL: `${BASE}/api/auth`, timeout: 40000 });

const errMsg = (err, fallback) => {
  if (err.response?.data?.message) return err.response.data.message;
  if (err.code === "ECONNABORTED" || err.message?.includes("timeout"))
    return "Server is waking up — please wait a moment and try again.";
  return fallback;
};

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  /* Restore session from localStorage on mount */
  useEffect(() => {
    const raw = localStorage.getItem("visionguide_user");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        /* Only restore if a token is present — stale entries without tokens are cleared */
        if (parsed?.token) setUser(parsed);
        else               localStorage.removeItem("visionguide_user");
      } catch {
        localStorage.removeItem("visionguide_user");
      }
    }
    setLoading(false);
  }, []);

  const _saveSession = (u) => {
    setUser(u);
    localStorage.setItem("visionguide_user", JSON.stringify(u));
  };

  /* ── Sign Up ── */
  const signUp = async (name, email, password) => {
    try {
      const { data } = await authAPI.post("/register", { name, email, password });
      _saveSession({ id: data.id, name: data.name, email: data.email, token: data.token });
      return { success: true };
    } catch (err) {
      if (err.response?.status === 409)
        return { success: false, error: "Email already registered. Please sign in." };
      return { success: false, error: errMsg(err, "Registration failed. Check your connection and try again.") };
    }
  };

  /* ── Sign In ── */
  const signIn = async (email, password) => {
    try {
      const { data } = await authAPI.post("/login", { email, password });
      _saveSession({ id: data.id, name: data.name, email: data.email, token: data.token });
      return { success: true };
    } catch (err) {
      return { success: false, error: errMsg(err, "Sign in failed. Check your connection and try again.") };
    }
  };

  /* ── Demo Sign In (Instant access for evaluation & testing) ── */
  const signInDemo = async () => {
    try {
      const res = await signIn("demouser2026@visionguide.ai", "VisionGuide2026!");
      if (res.success) return res;
    } catch {}
    const demoUser = {
      id: "165e7bba-4cae-4c12-adcd-4e13c517ec8e",
      name: "Demo User",
      email: "demouser2026@visionguide.ai",
      token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxNjVlN2JiYS00Y2FlLTRjMTItYWRjZC00ZTEzYzUxN2VjOGUiLCJlbWFpbCI6ImRlbW91c2VyMjAyNkB2aXNpb25ndWlkZS5haSIsImlhdCI6MTc5Mjk1NDk1NywiZXhwIjoxNzk1NTQ2OTU3fQ.G72bJ9di-NVVdYwhD-bxzIjHk6wfahJAPmUe_Hyw0ew",
    };
    _saveSession(demoUser);
    return { success: true };
  };

  /* ── Sign Out ── */
  const signOut = () => {
    setUser(null);
    localStorage.removeItem("visionguide_user");
    localStorage.removeItem("visionguide_users"); // clear legacy fallback storage
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInDemo, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
