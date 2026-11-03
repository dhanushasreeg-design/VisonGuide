const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      localStore.syncFromRemote("emergency_contacts", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[emergency] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("emergency_contacts", (c) => !req.userId || c.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { name, phone } = req.body ?? {};
  const relation = req.body?.relation || req.body?.relationship;

  if (!name?.trim() || !phone?.trim() || !relation?.trim())
    return res.status(400).json({ message: "Name, phone and relation are required" });
  if (name.trim().length > 100)
    return res.status(400).json({ message: "Name must be 100 characters or fewer" });
  if (!/^\+?[\d\s\-() ]{7,20}$/.test(phone.trim()))
    return res.status(400).json({ message: "Invalid phone number (7–20 digits)" });
  if (relation.trim().length > 50)
    return res.status(400).json({ message: "Relation must be 50 characters or fewer" });

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("emergency_contacts")
      .insert([{ name: name.trim(), phone: phone.trim(), relation: relation.trim(), user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Mirror / fallback to local store
  const localItem = localStore.insert("emergency_contacts", {
    id: saved?.id || Date.now().toString(),
    name: name.trim(),
    phone: phone.trim(),
    relation: relation.trim(),
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
      .from("emergency_contacts")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  // Always delete from local store
  localStore.remove("emergency_contacts", (c) => String(c.id) === String(id));
  res.json({ message: "Emergency contact deleted successfully" });
}));

module.exports = router;
