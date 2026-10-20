const express    = require("express");
const bcrypt     = require("bcrypt");
const jwt        = require("jsonwebtoken");
const crypto     = require("crypto");
const supabase   = require("../config/supabase");
const localStore = require("../config/localStore");

const router        = express.Router();
const BCRYPT_ROUNDS = 12;

const signToken = (user) =>
  jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );

/* ── POST /api/auth/register ── */
router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body ?? {};

    if (!name?.trim() || !email?.trim() || !password)
      return res.status(400).json({ message: "Name, email and password are required." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return res.status(400).json({ message: "Please enter a valid email address." });
    if (password.length < 8)
      return res.status(400).json({ message: "Password must be at least 8 characters." });

    const normalEmail = email.trim().toLowerCase();

    // Check Supabase first, fallback to local users
    let existing = null;
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id")
        .eq("email", normalEmail)
        .maybeSingle();
      if (!error) existing = data;
    } catch {}

    if (!existing) {
      existing = localStore.find("users", (u) => (u.email || "").toLowerCase() === normalEmail)[0];
    }

    if (existing)
      return res.status(409).json({ message: "Email already registered. Please sign in." });

    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let createdUser = null;
    try {
      const { data, error } = await supabase
        .from("users")
        .insert([{ name: name.trim(), email: normalEmail, password_hash }])
        .select("id, name, email")
        .single();
      if (!error && data) createdUser = data;
    } catch {}

    // Fallback: save to local store if Supabase failed
    if (!createdUser) {
      createdUser = localStore.insert("users", {
        name: name.trim(),
        email: normalEmail,
        password: password_hash,
        password_hash,
      });
    }

    res.status(201).json({ id: createdUser.id, name: createdUser.name, email: createdUser.email, token: signToken(createdUser) });
  } catch (err) {
    const detail = err.cause?.message || err.message;
    console.error("[register]", detail);
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? `Registration failed: ${detail}` : "Registration failed. Please try again." });
  }
});

/* ── POST /api/auth/login ── */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email?.trim() || !password)
      return res.status(400).json({ message: "Email and password are required." });

    const normalEmail = email.trim().toLowerCase();
    let user = null;

    // 1. Try Supabase
    try {
      const { data, error } = await supabase
        .from("users")
        .select("id, name, email, password_hash")
        .eq("email", normalEmail)
        .maybeSingle();
      if (!error && data) user = data;
    } catch (sbErr) {
      console.warn("[login] Supabase lookup error:", sbErr.message);
    }

    // 2. Fallback to local users.json if Supabase is down/paused
    if (!user) {
      const match = localStore.find("users", (u) => (u.email || "").toLowerCase() === normalEmail)[0];
      if (match) {
        user = {
          id: match.id,
          name: match.name,
          email: match.email,
          password_hash: match.password_hash || match.password,
        };
      }
    }

    if (!user)
      return res.status(401).json({ message: "Invalid email or password." });

    // Verify password: check bcrypt or legacy SHA-256
    let valid = false;
    if (user.password_hash?.startsWith("$2b$") || user.password_hash?.startsWith("$2a$")) {
      valid = await bcrypt.compare(password, user.password_hash);
    } else if (user.password_hash?.length === 64) {
      const sha = crypto.createHash("sha256").update(password).digest("hex");
      valid = (sha === user.password_hash);
    } else {
      valid = await bcrypt.compare(password, user.password_hash).catch(() => false);
    }

    if (!valid)
      return res.status(401).json({ message: "Invalid email or password." });

    res.json({ id: user.id, name: user.name, email: user.email, token: signToken(user) });
  } catch (err) {
    const detail = err.cause?.message || err.message;
    console.error("[login]", detail);
    const isDev = process.env.NODE_ENV !== "production";
    res.status(500).json({ message: isDev ? `Login failed: ${detail}` : "Login failed. Please try again." });
  }
});

module.exports = router;
