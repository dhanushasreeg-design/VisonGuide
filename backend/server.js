const express    = require("express");
const cors       = require("cors");
const dotenv     = require("dotenv");
const rateLimit  = require("express-rate-limit");
const helmet     = require("helmet");
const auth       = require("./middleware/auth");

dotenv.config();

/* ── Fail fast if required env vars are missing ── */
["SUPABASE_URL", "SUPABASE_KEY", "API_KEY", "JWT_SECRET"].forEach(k => {
  if (!process.env[k]) {
    console.error(`[startup] Missing required environment variable: ${k}`);
    process.exit(1);
  }
});

const app = express();

/* ── Trust Render's reverse proxy so req.ip / rate-limiting sees real client IPs ── */
app.set("trust proxy", 1);

/* ── Security headers ── */
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — app uses inline styles

/* ── CORS ──────────────────────────────────────────────────────────────────────────
   Always allow localhost (dev) + any LAN IP.
   In production, FRONTEND_URL must be set to the deployed Vercel URL so that
   cross-origin requests from the live frontend are not blocked.
────────────────────────────────────────────────────────────────────────────────── */
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
]);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server / curl
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return cb(null, true);
    if (/^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return cb(null, true);
    if (/^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
}));

/* ── Body parser: cap at 10 kb to block oversized payloads ── */
app.use(express.json({ limit: "10kb" }));

/* ── General rate limit: 300 req / 15 min per IP ──────────────────────────────
   /health and / are exempt — Render pings /health every ~30s and those calls
   must never be throttled or the service gets marked as unhealthy.
────────────────────────────────────────────────────────────────────────────── */
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/health" || req.path === "/",
  message: { message: "Too many requests. Please try again later." },
}));

/* ── API key auth on all /api/* routes ── */
app.use(auth);

/* ── Health + root ── */
app.get("/", (req, res) => {
  res.json({
    app: "VisionGuide AI Backend",
    status: "running with Supabase database",
    endpoints: {
      emergencyContacts: "/api/emergency",
      articles:          "/api/articles",
      commands:          "/api/commands",
      navigation:        "/api/navigation",
      sosAlerts:         "/api/sos",
      savedLocations:    "/api/locations",
      feedback:          "/api/feedback",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status:    "ok",
    uptime:    Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/* ── Stricter rate limit for auth endpoints: 10 attempts / 15 min per IP ── */
app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please wait 15 minutes." },
}));

/* ── API Routes ── */
app.use("/api/auth",       require("./routes/authRoutes"));
app.use("/api/emergency",  require("./routes/emergencyRoutes"));
app.use("/api/articles",   require("./routes/articleRoutes"));
app.use("/api/commands",   require("./routes/commandRoutes"));
app.use("/api/navigation", require("./routes/navigationRoutes"));
app.use("/api/locations",  require("./routes/locationRoutes"));
app.use("/api/feedback",   require("./routes/feedbackRoutes"));

/* ── SOS gets a stricter limit: 5 alerts / 15 min per IP ──
   Scoped to POST only — GET (viewing history, incl. the Dashboard's
   auto-load) and DELETE must never count against the send budget, or a
   user could get rate-limited out of sending a real emergency alert just
   from browsing their own SOS history. ── */
const sosSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { message: "Too many SOS alerts. Please wait before sending another." },
});
app.use("/api/sos", (req, res, next) => {
  if (req.method === "POST") return sosSendLimiter(req, res, next);
  next();
});
app.use("/api/sos", require("./routes/sosRoutes"));

/* ── Global error handler (must be last) ── */
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err.stack);
  const status  = err.status || 500;
  const message = process.env.NODE_ENV === "production"
    ? "Internal server error"
    : err.message || "Internal server error";
  res.status(status).json({ message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`VisionGuide AI backend running on port ${PORT}`);
});
