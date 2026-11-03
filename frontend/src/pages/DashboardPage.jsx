import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAccessibility } from "../context/AccessibilityContext";
import DashboardLayout from "../components/DashboardLayout";
import API from "../api";

/* ── Quick navigation cards ── */
const quickLinks = [
  { path: "/dashboard/voice",     icon: "🎤", label: "Voice Assistant",    desc: "Speak commands",        color: "#facc15", bg: "rgba(250,204,21,0.08)" },
  { path: "/dashboard/emergency", icon: "📞", label: "Emergency Contacts",  desc: "Manage contacts",       color: "#22c55e", bg: "rgba(34,197,94,0.08)" },
  { path: "/dashboard/sos",       icon: "🚨", label: "SOS Alert",           desc: "Send emergency alert",  color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
  { path: "/dashboard/navigation",icon: "🗺️", label: "Navigation",          desc: "Open maps",             color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
  { path: "/dashboard/camera",    icon: "📷", label: "Camera OCR",          desc: "Scan & read text",      color: "#f472b6", bg: "rgba(244,114,182,0.08)" },
  { path: "/dashboard/safewalk",  icon: "🚶", label: "Safe Walk",           desc: "Auto-SOS timer",        color: "#fb923c", bg: "rgba(251,146,60,0.08)" },
  { path: "/dashboard/articles",  icon: "📖", label: "Article Reader",      desc: "Read aloud",            color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
  { path: "/dashboard/locations", icon: "📍", label: "Saved Locations",     desc: "Quick map access",      color: "#34d399", bg: "rgba(52,211,153,0.08)" },
  { path: "/dashboard/objects",   icon: "🔍", label: "Object Detection",    desc: "AI image analysis",     color: "#a78bfa", bg: "rgba(167,139,250,0.08)" },
  { path: "/dashboard/safety",    icon: "🛡️", label: "Safety Tips",         desc: "Read safety guides",    color: "#34d399", bg: "rgba(52,211,153,0.08)" },
  { path: "/dashboard/commands",  icon: "📋", label: "Command History",     desc: "Past commands",         color: "#f472b6", bg: "rgba(244,114,182,0.08)" },
  { path: "/dashboard/feedback",  icon: "💬", label: "Feedback",            desc: "Share thoughts",        color: "#fb923c", bg: "rgba(251,146,60,0.08)" },
  { path: "/dashboard/settings",  icon: "⚙️", label: "Settings",            desc: "Preferences & admin",   color: "#94a3b8", bg: "rgba(148,163,184,0.08)" },
];

/* ── Voice command suggestion chips ── */
const voiceSuggestions = [
  "read contacts", "read articles", "hotel near me",
  "send sos",      "open saved locations", "stop reading",
  "navigate to hospital", "open settings", "object detection",
];

/* ── Nearby places ── */
const nearbyPlaces = [
  { icon: "🏥", label: "Hospital",       query: "hospital" },
  { icon: "🏨", label: "Hotel",          query: "hotel" },
  { icon: "🏧", label: "ATM",            query: "ATM" },
  { icon: "💊", label: "Pharmacy",       query: "pharmacy" },
  { icon: "👮", label: "Police Station", query: "police+station" },
  { icon: "🚌", label: "Bus Stop",       query: "bus+stop" },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const { settings, speak } = useAccessibility();
  const bB = settings.bigButtons || settings.accessibilityMode;
  const [stats, setStats]     = useState({ contacts: 0, articles: 0, locations: 0, commands: 0, sos: 0 });
  const [loading, setLoading] = useState(true);
  const [greeting, setGreeting] = useState("Hello");
  const isDark = settings.theme === "dark";

  /* ─── Theme card colours ─── */
  const C = {
    welcomeBg:   isDark ? "#111827"              : "#ffffff",
    welcomeBorder: isDark ? "#1f2937"            : "rgba(0,0,0,0.09)",
    statBg:      isDark ? "#111827"              : "#ffffff",
    statBorder:  isDark ? "#1f2937"              : "rgba(0,0,0,0.09)",
    tipBg:       isDark ? "rgba(250,204,21,0.06)" : "rgba(250,204,21,0.12)",
    tipBorder:   isDark ? "rgba(250,204,21,0.15)" : "rgba(250,204,21,0.3)",
    sectionTitle: isDark ? "#f9fafb"             : "#0f172a",
    linkLabel:   isDark ? "#f9fafb"              : "#0f172a",
    linkDesc:    isDark ? "#6b7280"              : "#64748b",
    statLabel:   isDark ? "#6b7280"              : "#64748b",
    nearbyBg:    isDark ? "#111827"              : "#ffffff",
    nearbyBorder: isDark ? "#1f2937"             : "rgba(0,0,0,0.09)",
    suggBg:      isDark ? "rgba(250,204,21,0.06)" : "rgba(250,204,21,0.10)",
    suggBorder:  isDark ? "rgba(250,204,21,0.15)" : "rgba(250,204,21,0.25)",
    chipBg:      isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
    chipBorder:  isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
    chipColor:   isDark ? "#d1d5db"              : "#334155",
    subtitleColor: isDark ? "#9ca3af"            : "#64748b",
  };

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12)       setGreeting("Good morning");
    else if (h < 17)  setGreeting("Good afternoon");
    else              setGreeting("Good evening");

    const load = async () => {
      try {
        const [c, a, l, cmd, sos] = await Promise.allSettled([
          API.get("/emergency"),
          API.get("/articles"),
          API.get("/locations"),
          API.get("/commands"),
          API.get("/sos"),
        ]);
        setStats({
          contacts:  c.status   === "fulfilled" ? c.value.data.length   : 0,
          articles:  a.status   === "fulfilled" ? a.value.data.length   : 0,
          locations: l.status   === "fulfilled" ? l.value.data.length   : 0,
          commands:  cmd.status === "fulfilled" ? cmd.value.data.length : 0,
          sos:       sos.status === "fulfilled" ? sos.value.data.length : 0,
        });
      } catch (_) {}
      setLoading(false);
    };
    load();

    /* Welcome voice-guided — use computed greeting directly, not stale state */
    if (settings.voiceGuided) {
      const h = new Date().getHours();
      const g = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
      setTimeout(() => speak(`${g}, ${user?.name}. Welcome to your VisionGuide AI dashboard.`), 600);
    }
  }, []); // eslint-disable-line

  const openNearby = (query) => {
    window.open(`https://www.google.com/maps/search/${query}+near+me`, "_blank");
  };

  const trySpeak = (text) => {
    speak(text);
  };

  const statCards = [
    { label: "Emergency Contacts", value: stats.contacts,  icon: "📞", color: "#22c55e" },
    { label: "Articles Saved",     value: stats.articles,  icon: "📖", color: "#60a5fa" },
    { label: "Commands Used",      value: stats.commands,  icon: "🎤", color: "#facc15" },
    { label: "SOS Alerts",         value: stats.sos,       icon: "🚨", color: "#ef4444" },
    { label: "Saved Locations",    value: stats.locations, icon: "📍", color: "#34d399" },
  ];

  return (
    <DashboardLayout>
      <div className="fade-in">

        {/* ── Welcome Banner ── */}
        <div className="welcome-banner" style={{
          ...st.welcome,
          background: C.welcomeBg,
          border: `${bB ? "2px" : "1px"} solid ${C.welcomeBorder}`,
          padding: bB ? "32px 34px" : "26px 30px",
        }}>
          <div>
            <h1 className="welcome-title" style={{ ...st.welcomeTitle, fontSize: bB ? "32px" : "26px", color: C.sectionTitle }}>
              {greeting}, <span style={{ color: "#22c55e" }}>{user?.name}</span> 👋
            </h1>
            <p style={{ ...st.welcomeSub, fontSize: bB ? "17px" : "14px", color: C.subtitleColor }}>
              Your VisionGuide AI dashboard — all features accessible by voice or click.
            </p>
          </div>
          <Link to="/dashboard/voice" className="voice-btn" style={{
            ...st.voiceBtn,
            fontSize: bB ? "17px" : "14px",
            padding: bB ? "16px 26px" : "13px 22px",
            borderRadius: bB ? "16px" : "12px",
          }}>
            <span style={{ fontSize: bB ? "28px" : "22px" }}>🎤</span>
            Start Voice Assistant
          </Link>
        </div>

        {/* ── Smart Dashboard Stats (5 cards) ── */}
        <h2 style={{ ...st.sectionTitle, fontSize: bB ? "24px" : "18px", color: C.sectionTitle }}>📊 Smart Dashboard</h2>
        <div className="stats-grid">
          {statCards.map(card => (
            <div key={card.label} style={{
              ...st.statCard,
              background: C.statBg,
              border: `${bB ? "2px" : "1px"} solid ${C.statBorder}`,
              padding: bB ? "26px 18px" : "18px 14px",
            }}>
              <div style={{ fontSize: bB ? "46px" : "26px", marginBottom: "8px" }}>{card.icon}</div>
              <div style={{ ...st.statVal, fontSize: bB ? "42px" : "32px", color: card.color }}>{loading ? "—" : card.value}</div>
              <div style={{ ...st.statLabel, fontSize: bB ? "16px" : "12px", fontWeight: 700, color: C.statLabel }}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* ── Voice Command Suggestions ── */}
        <div style={{ ...st.suggBox, background: C.suggBg, border: `${bB ? "2px" : "1px"} solid ${C.suggBorder}`, padding: bB ? "24px" : "18px" }}>
          <div style={st.suggHeader}>
            <span style={{ fontSize: bB ? "30px" : "22px" }}>💬</span>
            <div>
              <strong style={{ color: "#facc15", fontSize: bB ? "18px" : "15px" }}>Voice Command Suggestions</strong>
              <p style={{ color: C.subtitleColor, fontSize: bB ? "15px" : "13px", marginTop: "4px" }}>
                Tap a chip to hear it spoken, or say any of these in the Voice Assistant
              </p>
            </div>
          </div>
          <div style={st.chipsWrap}>
            {voiceSuggestions.map(s => (
              <button
                key={s}
                style={{
                  ...st.chip,
                  background: C.chipBg,
                  border: `${bB ? "2px" : "1px"} solid ${C.chipBorder}`,
                  color: C.chipColor,
                  fontSize: bB ? "16px" : "13px",
                  padding: bB ? "12px 24px" : "7px 14px",
                  minHeight: bB ? "52px" : "auto",
                  borderRadius: bB ? "16px" : "20px",
                  fontWeight: bB ? 700 : 500,
                }}
                onClick={() => trySpeak(s)}
                title={`Click to hear: "${s}"`}
              >
                <span style={{ fontSize: bB ? "20px" : "15px", marginRight: "6px" }}>🎤</span>{s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Nearby Place Finder ── */}
        <h2 style={{ ...st.sectionTitle, fontSize: bB ? "24px" : "18px", color: C.sectionTitle }}>🗺️ Find Nearby Places</h2>
        <div className="nearby-grid">
          {nearbyPlaces.map(p => (
            <button
              key={p.query}
              style={{
                ...st.nearbyBtn,
                background: C.nearbyBg,
                border: `${bB ? "2px" : "1px"} solid ${C.nearbyBorder}`,
                padding: bB ? "26px 18px" : "20px 12px",
                minHeight: bB ? "124px" : "auto",
                borderRadius: bB ? "18px" : "14px",
              }}
              onClick={() => { openNearby(p.query); speak(`Opening Google Maps for ${p.label} near you.`); }}
              aria-label={`Find ${p.label} near me. Opens Google Maps.`}
              title={`Find ${p.label} near me`}
            >
              <span style={{ fontSize: bB ? "50px" : "28px", marginBottom: bB ? "6px" : "0" }}>{p.icon}</span>
              <span style={{ ...st.nearbyLabel, fontSize: bB ? "19px" : "14px", fontWeight: 800, color: C.sectionTitle }}>Find {p.label}</span>
              <span style={{ fontSize: bB ? "15px" : "11px", color: "#22c55e", fontWeight: 700 }}>Near Me →</span>
            </button>
          ))}
        </div>

        {/* ── Quick Access cards ── */}
        <h2 style={{ ...st.sectionTitle, fontSize: bB ? "24px" : "18px", color: C.sectionTitle }}>⚡ Quick Access</h2>
        <div className="links-grid">
          {quickLinks.map(item => (
            <Link
              key={item.path}
              to={item.path}
              aria-label={`${item.label}. ${item.desc}`}
              title={item.label}
              style={{
                ...st.linkCard,
                background: item.bg,
                border: `${bB ? "2px" : "1px"} solid ${item.color}45`,
                padding: bB ? "28px 24px" : "18px",
                borderRadius: bB ? "18px" : "14px",
              }}
            >
              <div style={{ fontSize: bB ? "52px" : "30px", marginBottom: bB ? "12px" : "8px" }}>{item.icon}</div>
              <div style={{ ...st.linkLabel, fontSize: bB ? "20px" : "14px", fontWeight: 800, color: C.linkLabel }}>{item.label}</div>
              <div style={{ ...st.linkDesc, fontSize: bB ? "15px" : "12px", color: C.linkDesc, lineHeight: 1.5 }}>{item.desc}</div>
              <div style={{ ...st.linkArrow, fontSize: bB ? "26px" : "16px", color: item.color, fontWeight: 900 }}>→</div>
            </Link>
          ))}
        </div>

      </div>
    </DashboardLayout>
  );
}

const st = {
  welcome:      { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "20px", marginBottom: "28px", borderRadius: "16px", padding: "26px 30px" },
  welcomeTitle: { fontSize: "26px", fontWeight: 800, marginBottom: "6px" },
  welcomeSub:   { fontSize: "14px" },
  voiceBtn:     { display: "flex", alignItems: "center", gap: "10px", background: "#facc15", color: "#000", padding: "13px 22px", borderRadius: "12px", textDecoration: "none", fontWeight: 700, fontSize: "14px", whiteSpace: "nowrap" },
  sectionTitle: { fontSize: "18px", fontWeight: 700, marginBottom: "16px", marginTop: "8px" },
  statsGrid:    { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "14px", marginBottom: "24px" },
  statCard:     { borderRadius: "14px", padding: "18px 14px", textAlign: "center" },
  statVal:      { fontSize: "32px", fontWeight: 900, marginBottom: "4px" },
  statLabel:    { fontSize: "12px" },
  suggBox:      { borderRadius: "14px", padding: "18px 20px", marginBottom: "28px" },
  suggHeader:   { display: "flex", alignItems: "flex-start", gap: "12px", marginBottom: "14px" },
  chipsWrap:    { display: "flex", flexWrap: "wrap", gap: "8px" },
  chip:         { padding: "7px 14px", borderRadius: "40px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", fontWeight: 600, transition: "all 0.15s" },
  nearbyGrid:   { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px", marginBottom: "32px" },
  nearbyBtn:    { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", padding: "20px 12px", borderRadius: "14px", cursor: "pointer", fontFamily: "inherit", transition: "transform 0.15s, box-shadow 0.15s", textAlign: "center" },
  nearbyLabel:  { fontSize: "14px", fontWeight: 700 },
  linksGrid:    { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px", marginBottom: "20px" },
  linkCard:     { display: "flex", flexDirection: "column", padding: "18px", borderRadius: "14px", textDecoration: "none", transition: "transform 0.15s", position: "relative" },
  linkLabel:    { fontSize: "14px", fontWeight: 700, marginBottom: "4px" },
  linkDesc:     { fontSize: "12px", marginBottom: "10px" },
  linkArrow:    { fontSize: "16px", fontWeight: 700 },
};
