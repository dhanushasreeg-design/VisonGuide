const express      = require("express");
const supabase     = require("../config/supabase");
const localStore   = require("../config/localStore");
const asyncHandler = require("../middleware/asyncHandler");

const router = express.Router();

router.get("/", asyncHandler(async (req, res) => {
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("articles")
      .select("*")
      .eq("user_id", req.userId)
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) {
      localStore.syncFromRemote("articles", data, req.userId);
      return res.json(data);
    }
  } catch (sbErr) {
    console.warn("[articles] Supabase offline/paused — using local fallback:", sbErr.message);
  }

  // 2. Fallback to local offline store
  const localItems = localStore.find("articles", (a) => !req.userId || a.user_id === req.userId);
  res.json(localItems);
}));

router.post("/", asyncHandler(async (req, res) => {
  const { title, content } = req.body ?? {};

  if (!title?.trim() || !content?.trim())
    return res.status(400).json({ message: "Title and content are required" });
  if (title.trim().length > 200)
    return res.status(400).json({ message: "Title must be 200 characters or fewer" });
  if (content.trim().length > 20000)
    return res.status(400).json({ message: "Content must be 20,000 characters or fewer" });

  let saved = null;
  // 1. Try Supabase
  try {
    const { data, error } = await supabase
      .from("articles")
      .insert([{ title: title.trim(), content: content.trim(), user_id: req.userId }])
      .select();
    if (!error && data?.length) saved = data[0];
  } catch {}

  // 2. Mirror / fallback to local store
  const localItem = localStore.insert("articles", {
    id: saved?.id || Date.now().toString(),
    title: title.trim(),
    content: content.trim(),
    user_id: req.userId,
    created_at: saved?.created_at || new Date().toISOString(),
  });

  res.status(201).json(saved || localItem);
}));

router.delete("/:id", asyncHandler(async (req, res) => {
  const id = req.params.id;
  try {
    await supabase
      .from("articles")
      .delete()
      .eq("id", id)
      .eq("user_id", req.userId);
  } catch {}

  localStore.remove("articles", (a) => String(a.id) === String(id));
  res.json({ message: "Article deleted successfully" });
}));

module.exports = router;
