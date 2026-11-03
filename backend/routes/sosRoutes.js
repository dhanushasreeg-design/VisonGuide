const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      localStore.syncFromRemote("sos_alerts", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[sos] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("sos_alerts", (s) => !req.userId || s.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { message, location } = req.body ?? {};

  if (!message?.trim())
    return res.status(400).json({ message: "SOS message is required" });
  if (message.trim().length > 500)
    return res.status(400).json({ message: "Message must be 500 characters or fewer" });
  if (location && location.length > 300)
    return res.status(400).json({ message: "Location must be 300 characters or fewer" });

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("sos_alerts")
      .insert([{ message: message.trim(), location: location?.trim() ?? null, status: "sent", user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Mirror / fallback to local store
  const localItem = localStore.insert("sos_alerts", {
    id: saved?.id || Date.now().toString(),
    message: message.trim(),
    location: location?.trim() ?? null,
    status: "sent",
    user_id: req.userId,
    created_at: saved?.created_at || new Date().toISOString(),
  });

  res.status(201).json(saved || localItem);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  try {
    await supabase
      .from("sos_alerts")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  localStore.remove("sos_alerts", (s) => String(s.id) === String(id));
  res.json({ message: "SOS alert deleted successfully" });
}));

module.exports = router;
