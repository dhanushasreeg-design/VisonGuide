const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("navigation_requests")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      localStore.syncFromRemote("navigation_requests", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[navigation] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("navigation_requests", (r) => !req.userId || r.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { destination } = req.body ?? {};

  if (!destination?.trim())
    return res.status(400).json({ message: "Destination is required" });
  if (destination.trim().length > 300)
    return res.status(400).json({ message: "Destination must be 300 characters or fewer" });

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("navigation_requests")
      .insert([{ destination: destination.trim(), status: "requested", user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Mirror / fallback to local store
  const localItem = localStore.insert("navigation_requests", {
    id: saved?.id || Date.now().toString(),
    destination: destination.trim(),
    status: "requested",
    user_id: req.userId,
    created_at: saved?.created_at || new Date().toISOString(),
  });

  res.status(201).json(saved || localItem);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  // Try Supabase delete
  try {
    await supabase
      .from("navigation_requests")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  // Always delete from local store
  localStore.remove("navigation_requests", (r) => String(r.id) === String(id));
  res.json({ message: "Navigation request deleted successfully" });
}));

module.exports = router;
