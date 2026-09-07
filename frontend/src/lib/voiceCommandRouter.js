/* Pure, dependency-free app-page matcher for the Voice Assistant.
   Extracted out of VoiceAssistantPage.jsx so it can be unit-tested without
   React/DOM (see voiceCommandRouter.test.mjs) and so the alias list lives
   in one place instead of being duplicated.

   Each entry's `keys` are checked with the SAME `normalizedText.includes(key)`
   substring test the rest of the command parser already uses. Order matters:
   the first entry with a matching key wins, so more specific destinations
   (Object Detection, Camera/OCR, Navigation) are listed before the generic
   ones (Dashboard, Settings) to avoid a generic key accidentally shadowing a
   specific one. Within this list no key is a substring of a key belonging to
   a DIFFERENT entry, so there is no ordering ambiguity between entries. */

export const APP_SHORTCUTS = [
  {
    path: "/dashboard/objects",
    label: "Object Detection",
    keys: [
      "object", // covers "object detection", "objects", "detect objects", etc.
      "what is in this image",
      "analyze this image",
      "analyze the image",
    ],
  },
  {
    path: "/dashboard/camera",
    label: "Camera Text Reader",
    keys: [
      "camera", // covers "camera text reader", "camera ocr", etc.
      "text reader",
      "read text",
      "read this text",
      "read the text",
      "scan text",
      "scan this",
      "scan a document",
      "read document",
      "ocr",
    ],
  },
  {
    path: "/dashboard/navigation",
    label: "Navigation",
    keys: [
      "navigation",
      "navigate",
      "start navigation",
      "help me navigate",
      "where am i",
      "find nearby places",
      "find places near me",
    ],
  },
  {
    path: "/dashboard",
    label: "Dashboard",
    keys: ["dashboard", "home", "open dashboard", "main menu"],
  },
  {
    path: "/dashboard/settings",
    label: "Settings",
    keys: ["settings", "open settings"],
  },
];

/* Returns the first matching shortcut { path, label } for an already
   lowercased/trimmed command string, or null if none match. */
export function matchAppShortcut(normalizedText) {
  const t = normalizedText || "";
  for (const shortcut of APP_SHORTCUTS) {
    if (shortcut.keys.some((key) => t.includes(key))) return shortcut;
  }
  return null;
}
