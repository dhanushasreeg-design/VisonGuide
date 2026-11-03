const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("saved_locations")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      // Sync locally for offline preservation
      localStore.syncFromRemote("saved_locations", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[locations] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("saved_locations", (l) => !req.userId || l.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const place_name = req.body?.place_name || req.body?.name;
  const { address } = req.body ?? {};

  if (!place_name?.trim())
    return res.status(400).json({ message: "Place name is required" });
  if (place_name.trim().length > 100)
    return res.status(400).json({ message: "Place name must be 100 characters or fewer" });
  if (address && address.length > 300)
    return res.status(400).json({ message: "Address must be 300 characters or fewer" });

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("saved_locations")
      .insert([{ place_name: place_name.trim(), address: address?.trim() ?? null, user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Fallback / mirror to local store
  const localItem = localStore.insert("saved_locations", {
    id: saved?.id || Date.now().toString(),
    place_name: place_name.trim(),
    address: address?.trim() ?? null,
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
      .from("saved_locations")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  // Always delete from local store
  localStore.remove("saved_locations", (l) => String(l.id) === String(id));
  res.json({ message: "Saved location deleted successfully" });
}));

module.exports = router;
