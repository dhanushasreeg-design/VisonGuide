const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("user_feedback")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      localStore.syncFromRemote("user_feedback", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[feedback] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("user_feedback", (f) => !req.userId || f.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { name, feedback, rating } = req.body ?? {};

  if (!feedback?.trim())
    return res.status(400).json({ message: "Feedback is required" });
  if (feedback.trim().length > 2000)
    return res.status(400).json({ message: "Feedback must be 2,000 characters or fewer" });
  if (name && name.length > 100)
    return res.status(400).json({ message: "Name must be 100 characters or fewer" });

  let cleanRating = null;
  if (rating !== undefined && rating !== null && rating !== "") {
    cleanRating = parseInt(rating, 10);
    if (isNaN(cleanRating) || cleanRating < 1 || cleanRating > 5)
      return res.status(400).json({ message: "Rating must be a number between 1 and 5" });
  }

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("user_feedback")
      .insert([{ name: name?.trim() ?? null, feedback: feedback.trim(), rating: cleanRating, user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Mirror / fallback to local store
  const localItem = localStore.insert("user_feedback", {
    id: saved?.id || Date.now().toString(),
    name: name?.trim() ?? null,
    feedback: feedback.trim(),
    rating: cleanRating,
    user_id: req.userId,
    created_at: saved?.created_at || new Date().toISOString(),
  });

  res.status(201).json(saved || localItem);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  try {
    await supabase
      .from("user_feedback")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  localStore.remove("user_feedback", (f) => String(f.id) === String(id));
  res.json({ message: "Feedback deleted successfully" });
}));

module.exports = router;
