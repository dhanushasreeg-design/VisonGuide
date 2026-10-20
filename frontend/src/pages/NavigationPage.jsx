import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { useAccessibility } from "../context/AccessibilityContext";
import API from "../api";
import {
  ROUTING_MODES as MODES,
  classifyAccuracy,
  computeDynamicOffRouteThreshold,
  checkArrivalEligibility,
  estimateTravelDuration as estimateDuration,
  isValidCoordinate,
  haversineM,
  haversineKm,
  formatDistanceForSpeech,
  buildCleanAddress,
  cleanPlaceName,
  searchNearbyPlaces,
  WALK_SPEED_MPS,
  CYCLE_SPEED_MPS,
} from "../lib/routingService";

/* ─────────────────────────────────────────────────────────────────────────────
   SAFE JSON — catches XML / HTML error pages from public APIs
───────────────────────────────────────────────────────────────────────────── */
const safeJson = async (res) => {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    await res.text();
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error("GATEWAY_TIMEOUT");
    }
    throw new Error(`Server returned an error (HTTP ${res.status}). Please try again.`);
  }
  return res.json();
};

/* ─────────────────────────────────────────────────────────────────────────────
   DIRECTION HELPERS
───────────────────────────────────────────────────────────────────────────── */
const DIR_ICON = {
  right: "→", sharp_right: "↱", slight_right: "↗",
  left: "←", sharp_left: "↰", slight_left: "↖",
  straight: "↑", uturn: "↩", depart: "▶", arrive: "🏁",
  roundabout: "🔄", rotary: "🔄",
};

const getIcon = (m) => {
  if (!m) return "↑";
  if (m.type === "depart")  return "▶";
  if (m.type === "arrive")  return "🏁";
  if (m.type === "roundabout" || m.type === "rotary") return "🔄";
  const mod = (m.modifier || "straight").replace(/ /g, "_");
  return DIR_ICON[mod] || "↑";
};

const getInstruction = (m) => {
  if (!m) return "Continue";
  if (m.type === "depart")  return "Head out";
  if (m.type === "arrive")  return "Arrive at destination";
  if (m.type === "roundabout" || m.type === "rotary") {
    return m.exit ? `Take exit ${m.exit} at the roundabout` : "Take the roundabout";
  }
  const mod = m.modifier || "";
  if (mod === "sharp right")  return "Turn sharp right";
  if (mod === "right")        return "Turn right";
  if (mod === "slight right") return "Bear right";
  if (mod === "sharp left")   return "Turn sharp left";
  if (mod === "left")         return "Turn left";
  if (mod === "slight left")  return "Bear left";
  if (mod === "uturn")        return "Make a U-turn";
  if (mod === "straight")     return "Continue straight";
  return "Continue";
};

const fmtDist = (m) => {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
};

const fmtTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) return `${h} hr ${m} min`;
  if (m > 0) return `${m} min ${sec} sec`;
  return `${sec} sec`;
};

const fmtETA = (seconds) => {
  const eta = new Date(Date.now() + seconds * 1000);
  return eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};


/* Runs a promise against a hard wall-clock deadline. Used as a backstop
   around the whole route-fetch flow so no internal await — even one we
   didn't anticipate — can leave routeStatus stuck on a loading value. */
const withTimeout = (promise, ms, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });

/* A, B, C, ... Z, AA, AB, ... — voice- and card-friendly labels for
   sorted nearby-result lists. */
const letterLabel = (i) => {
  let n = i, label = "";
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
};
const withLabels = (arr) => arr.map((p, i) => ({ ...p, label: letterLabel(i) }));

/* ─────────────────────────────────────────────────────────────────────────────
   TRANSPORT MODES & PEDESTRIAN MAPPING (Zero API Keys)
   Walk: OpenStreetMap Germany routed-foot (routes through authentic pedestrian
   footways, pedestrian subways, and alleyways) with failover to OSRM.
   Bike: routed-bike with failover to OSRM.
   Car:  OSRM driving with failover to routed-car.
   MODES, WALK_SPEED_MPS, CYCLE_SPEED_MPS, and estimateDuration are imported
   from ../lib/routingService.
───────────────────────────────────────────────────────────────────────────── */


/* ─────────────────────────────────────────────────────────────────────────────
   PROXIMITY THRESHOLDS (metres)
   Announce upcoming maneuver at ANNOUNCE_DIST; say "now" at FINAL_DIST.
   Mark step complete when user passes within COMPLETE_DIST of the waypoint.
───────────────────────────────────────────────────────────────────────────── */
const ANNOUNCE_DIST  = 150;  // speak "Turn right in X m"
const FINAL_DIST     = 25;   // speak "Turn right now"
const COMPLETE_DIST  = 40;   // step considered passed
const OFF_ROUTE_DIST = 80;   // metres off the current step's path before rerouting
const ARRIVAL_DIST   = 30;   // metres from destination → arrived

/* JS-level watchdog for getCurrentLocation(): guarantees the promise settles
   even if the browser never invokes either geolocation callback (seen on some
   mobile browsers when backgrounded, or on certain GPS driver bugs). Kept
   slightly above the native getCurrentPosition timeout (12s) so a normal
   native timeout error surfaces first with its specific message. */
const LOCATION_WATCHDOG_MS = 15000;

/* A cached currentPos is only reused for a nearby-places search if it is
   younger than this — otherwise we re-fetch so "nearest" reflects where the
   user actually is now, not where they were last time a fix was taken. */
const FRESH_POS_MAX_AGE_MS = 20000;

/* ─────────────────────────────────────────────────────────────────────────────
   NEAR-ME HELPERS
───────────────────────────────────────────────────────────────────────────── */
const NEAR_ME_RE = /\b(near me|nearby|nearest|close by|around me)\b/i;

const amenityFromQuery = (q) => {
  const t = q.toLowerCase();
  if (/hospital|clinic|doctor|medical/.test(t))                    return "hospital";
  if (/pharmacy|medicine|chemist|drug/.test(t))                    return "pharmacy";
  if (/\batm\b|cash machine|withdraw/.test(t))                     return "atm";
  if (/police|cop/.test(t))                                        return "police";
  if (/railway|train station|rail station|metro station/.test(t))  return "train_station";
  if (/bus stop|bus stand|bus station/.test(t))                    return "bus_stop";
  if (/airport|aerodrome/.test(t))                                 return "aerodrome";
  if (/hotel|lodge|motel|accommodation/.test(t))                   return "hotel";
  if (/restaurant|food|cafe|coffee|fast food/.test(t))             return "restaurant";
  if (/\bbank\b/.test(t))                                          return "bank";
  if (/petrol|fuel|gas station|filling station/.test(t))           return "fuel";
  if (/supermarket|grocery|mall/.test(t))                          return "supermarket";
  if (/college|university/.test(t))                                return "college";
  if (/school/.test(t))                                            return "school";
  return null;
};

const AMENITY_ICON = {
  hospital: "🏥", pharmacy: "💊", atm: "🏧", police: "👮",
  restaurant: "🍽️", cafe: "☕", hotel: "🏨", bank: "🏦",
  supermarket: "🛒", bus_station: "🚌", clinic: "🏥", school: "🏫",
  train_station: "🚉", bus_stop: "🚌", fuel: "⛽", aerodrome: "✈️",
  college: "🎓",
};

/* ─────────────────────────────────────────────────────────────────────────────
   RESULT QUALITY — a blind user has to trust these names/addresses without
   seeing the place, so generic/placeholder OSM names are rejected rather
   than presented as real recommendations.
───────────────────────────────────────────────────────────────────────────── */
const GENERIC_NAME_RE = /^(hospital|clinic|medical( centre| center)?|health\s?care( facility)?|point\s?[a-z]\b.*|unnamed|n\/?a|unknown|amenity)$/i;

const isValidPlaceName = (name) => {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (trimmed.length < 3) return false;
  if (GENERIC_NAME_RE.test(trimmed)) return false;
  return true;
};

/* Builds human-readable address from OSM tags or Nominatim address details. */
const buildAddress = (obj = {}) => buildCleanAddress(obj);

/* Removes near-identical duplicate results — the same real-world place
   often exists as both a node and a way (or two adjacent OSM records) at
   nearly the same coordinates with the same (or no) name. */
const dedupePlaces = (sortedByDistance) => {
  const deduped = [];
  for (const p of sortedByDistance) {
    const isDup = deduped.some(k =>
      haversineM(k.lat, k.lon, p.lat, p.lon) < 50 &&
      (k.name || "").toLowerCase() === (p.name || "").toLowerCase()
    );
    if (!isDup) deduped.push(p);
  }
  return deduped;
};

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function NavigationPage() {
  const { settings, speak } = useAccessibility();
  const [searchParams] = useSearchParams();
  const isDark = settings.theme === "dark";

  /* ── Core state ── */
  const [destination,   setDestination]   = useState("");
  const [startLocation, setStartLocation] = useState("");
  const [currentPos,    setCurrentPos]    = useState(null);
  const [transportMode, setTransportMode] = useState("driving");
  const [routeStatus,   setRouteStatus]   = useState("idle");
  const [route,         setRoute]         = useState(null);
  const [nearbyPlaces,  setNearbyPlaces]  = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [errorMsg,      setErrorMsg]      = useState("");
  const [savedLocations,setSavedLocations]= useState([]);
  const [voiceListening,setVoiceListening]= useState(false);
  const [requests,      setRequests]      = useState([]);

  /* ── Nearby Places panel state ── */
  const [nearbyCategory,  setNearbyCategory]  = useState("all"); // "all" | amenity key
  const [nearbyExpanded,  setNearbyExpanded]  = useState(false); // show all vs top 5
  const [nearbyError,     setNearbyError]     = useState("");
  // True only once a nearby search has actually completed (success or empty)
  // — distinguishes "haven't searched yet" from "searched, found nothing" so
  // "No nearby places found" is never shown prematurely.
  const [nearbySearched,  setNearbySearched]  = useState(false);

  /* ── Live navigation state ── */
  const [navActive,     setNavActive]     = useState(false);
  const [navStatus,     setNavStatus]     = useState("idle");
  // "idle" | "active" | "approaching" | "arrived" | "off_route" | "recalculating"
  const [livePos,       setLivePos]       = useState(null);
  const [currentStepIdx,setCurrentStepIdx]= useState(0);
  const [stepStates,    setStepStates]    = useState([]); // "pending"|"announced"|"final"|"completed"
  const [distToNext,    setDistToNext]    = useState(null);

  /* ── Refs (avoid stale closures in watchPosition callback) ── */
  const routeRef          = useRef(null);
  const stepStatesRef     = useRef([]);
  const currentStepIdxRef = useRef(0);
  const navActiveRef      = useRef(false);
  const stopRef           = useRef(false);
  const nearbyStopRef     = useRef(false); // cancels an in-flight nearby-places search on Clear
  const watchIdRef        = useRef(null);
  const recRef            = useRef(null);
  const rerouting         = useRef(false);
  const destRef           = useRef({ lat: null, lon: null, label: "" });
  const routeReqRef       = useRef(0); // monotonic token — guarantees a slower/stale route request can never overwrite a newer one's result
  const transportModeRef  = useRef("driving");
  const followUpActiveRef = useRef(false); // guards against starting a second, overlapping recognizer

  /* Keep refs in sync */
  useEffect(() => { stepStatesRef.current = stepStates; }, [stepStates]);
  useEffect(() => { currentStepIdxRef.current = currentStepIdx; }, [currentStepIdx]);
  useEffect(() => { navActiveRef.current = navActive; }, [navActive]);
  useEffect(() => { transportModeRef.current = transportMode; }, [transportMode]);

  /* ── Colour tokens ── */
  const C = {
    card:   isDark ? "#111827" : "#ffffff",
    border: isDark ? "#1f2937" : "rgba(0,0,0,0.1)",
    text:   isDark ? "#f9fafb" : "#0f172a",
    sub:    isDark ? "#9ca3af" : "#64748b",
    input:  isDark ? "#0a0f1e" : "#f8fafc",
    inBd:   isDark ? "#374151" : "rgba(0,0,0,0.15)",
  };

  /* ─────────────────────────────────────────────────────────────────────────
     LOAD SAVED LOCATIONS + HISTORY
  ───────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    API.get("/locations").then(r => setSavedLocations(r.data)).catch(() => {});
    API.get("/navigation").then(r => setRequests(r.data)).catch(() => {});
  }, []);

  /* ── Auto-route from URL param ── */
  useEffect(() => {
    const d = searchParams.get("dest");
    if (d) { setDestination(d); setTimeout(() => startRoute(d), 600); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Cleanup watchPosition on unmount ── */
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  /* ─────────────────────────────────────────────────────────────────────────
     GPS HELPERS
  ───────────────────────────────────────────────────────────────────────── */
  const getCurrentLocation = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not supported on this device or browser."));
      return;
    }

    // Guarantees this promise always settles, even if the browser never
    // invokes either the success or error callback (seen in practice when a
    // tab is backgrounded mid-request, or on some GPS driver bugs). Without
    // this, callers relying on the promise (routeStatus/nearbyLoading) can
    // be left "loading" forever.
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("I couldn't get your location in time. Please check your GPS/location settings and try again."));
    }, LOCATION_WATCHDOG_MS);

    const settleResolve = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(val);
    };
    const settleReject = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      reject(err);
    };

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        if (!isValidCoordinate(lat, lon)) {
          settleReject(new Error("Invalid GPS coordinates received from browser."));
          return;
        }
        const accInfo = classifyAccuracy(accuracy);
        // Reverse-geocode with a hard 8 s timeout so a slow/rate-limited
        // Nominatim response can never leave the caller stuck indefinitely.
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          let data = null;
          try {
            const r = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2`,
              { headers: { "User-Agent": "VisionGuideAI/1.0" }, signal: ctrl.signal }
            );
            data = await safeJson(r);
          } finally {
            clearTimeout(timer);
          }
          const label = data?.display_name?.split(",").slice(0, 2).join(", ") || "Your location";
          const countryCode = data?.address?.country_code || "";
          settleResolve({
            lat,
            lon,
            accuracy: accInfo.accuracy,
            accuracyTier: accInfo.tier,
            accuracyLabel: accInfo.label,
            accuracyAdvisory: accInfo.advisory,
            label,
            countryCode,
            ts: Date.now()
          });
        } catch {
          // Nominatim failed or timed out — still resolve with coordinates only
          settleResolve({
            lat,
            lon,
            accuracy: accInfo.accuracy,
            accuracyTier: accInfo.tier,
            accuracyLabel: accInfo.label,
            accuracyAdvisory: accInfo.advisory,
            label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
            countryCode: "",
            ts: Date.now()
          });
        }
      },
      (err) => {
        let msg = "Location unavailable. Please check your location settings or enter a manual start location.";
        if (err.code === 1) msg = "Location access was denied. Please allow location access or enter a starting address.";
        else if (err.code === 2) msg = "Your GPS location is currently unavailable. Try entering a starting address.";
        else if (err.code === 3) msg = "GPS timed out. Check your location settings or enter a starting address.";
        settleReject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });

  /* ─────────────────────────────────────────────────────────────────────────
     GEOCODE (Nominatim, bounded to user's area)
  ───────────────────────────────────────────────────────────────────────── */
  const geocode = async (query, nearLat, nearLon, countryCode = "") => {
    const cc  = countryCode ? `&countrycodes=${countryCode}` : "";
    const box = nearLat && nearLon
      ? `&viewbox=${nearLon - 0.5},${nearLat + 0.5},${nearLon + 0.5},${nearLat - 0.5}&bounded=1`
      : "";
    const run = async (extra = "") => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=8&addressdetails=1${cc}${extra}`,
          { headers: { "User-Agent": "VisionGuideAI/1.0" }, signal: ctrl.signal }
        );
        if (r.status === 429) throw new Error("RATE_LIMITED");
        return await safeJson(r);
      } catch (err) {
        if (err.name === "AbortError") throw new Error("The location search timed out. Please try again.");
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };
    // Each fallback attempt runs even if a prior one errored (not just if it
    // was merely empty) — a transient 429/timeout on the bounded search
    // should not prevent trying the wider one.
    const tryRun = async (extra) => { try { return await run(extra); } catch { return []; } };
    let data = await tryRun(box);
    if (!data.length && nearLat) data = await tryRun();
    if (!data.length && countryCode) data = await tryRun("");
    if (!data.length) throw new Error(`Location not found: "${query}". Try adding your city name.`);
    let best = data[0];
    if (nearLat && nearLon && data.length > 1) {
      best = data.reduce((prev, cur) =>
        haversineKm(nearLat, nearLon, parseFloat(cur.lat), parseFloat(cur.lon)) <
        haversineKm(nearLat, nearLon, parseFloat(prev.lat), parseFloat(prev.lon))
          ? cur : prev
      );
    }
    return {
      lat:   parseFloat(best.lat),
      lon:   parseFloat(best.lon),
      label: best.display_name?.split(",").slice(0, 3).join(", "),
    };
  };

  /* ─────────────────────────────────────────────────────────────────────────
     OVERPASS NEAREST AMENITY
     Returns deduplicated places sorted by real Haversine distance from
     (lat, lon); caller picks top-N. For hospitals specifically — where a
     blind user has to trust a name without ever seeing the place — generic
     placeholder OSM names (e.g. "hospital", "Point B") are rejected, and the
     search radius expands until there are enough trustworthy-looking named
     results, not merely until the raw result count is non-zero.
  ───────────────────────────────────────────────────────────────────────── */
  const MIN_QUALITY_RESULTS = 3;

  /* Nominatim search query mapping for fast, reliable POI lookups */
  const NOMINATIM_TAG_MAP = {
    hospital: "hospital",
    pharmacy: "pharmacy",
    atm: "atm",
    police: "police station",
    bus_stop: "bus stop",
    train_station: "railway station",
    bank: "bank",
    restaurant: "restaurant",
    hotel: "hotel",
    supermarket: "supermarket",
    school: "school",
    clinic: "clinic",
    fuel: "petrol station",
  };

  /* ─────────────────────────────────────────────────────────────────────────
     FETCH & DISCOVER NEARBY PLACES (High-speed, zero API keys)
     Queries OpenStreetMap via searchNearbyPlaces in routingService.js.
     Fast, resilient, and sorted nearest first.
  ───────────────────────────────────────────────────────────────────────── */
  const fetchNearbyPlaces = async (userLat, userLon, cat = "all") => {
    setNearbyLoading(true);
    setNearbyError("");
    setNearbyPlaces([]);
    try {
      const places = await searchNearbyPlaces(cat, userLat, userLon, { radiusKm: 10 });
      if (nearbyStopRef.current) return [];
      if (!places || places.length === 0) {
        const catName = cat === "all" ? "places" : `${categoryWordFor(cat)}s`;
        const msg = `No ${catName} found near your location.`;
        setNearbyPlaces([]);
        setNearbyError(msg);
        speak(msg);
        return [];
      }
      const labelled = withLabels(places);
      if (!nearbyStopRef.current) setNearbyPlaces(labelled);
      return labelled;
    } catch (err) {
      if (!nearbyStopRef.current) {
        const msg = err.message || "Could not find nearby places. Please try again.";
        setNearbyError(msg);
        speak(msg);
      }
      return [];
    } finally {
      setNearbyLoading(false);
      if (!nearbyStopRef.current) setNearbySearched(true);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     FIND NEARBY PLACES (standalone — no route required)
     Called by "Find Places Near Me" button and category filter buttons.
  ───────────────────────────────────────────────────────────────────────── */
  const NEARBY_CATEGORIES = [
    { key: "all",           label: "All",             icon: "📍" },
    { key: "hospital",      label: "Hospital",        icon: "🏥" },
    { key: "pharmacy",      label: "Pharmacy",        icon: "💊" },
    { key: "atm",           label: "ATM",             icon: "🏧" },
    { key: "police",        label: "Police",          icon: "👮" },
    { key: "bus_stop",      label: "Bus Stop",        icon: "🚌" },
    { key: "train_station", label: "Railway Station", icon: "🚉" },
    { key: "bank",          label: "Bank",            icon: "🏦" },
    { key: "restaurant",    label: "Restaurant",      icon: "🍽️" },
    { key: "supermarket",   label: "Supermarket",     icon: "🛒" },
    { key: "school",        label: "School",          icon: "🏫" },
  ];

  /* Fetch for a specific category using searchNearbyPlaces */
  const findNearbyPlaces = async (cat = nearbyCategory) => {
    if (nearbyLoading) return;

    nearbyStopRef.current = false;
    setNearbyError("");
    setNearbyLoading(true);
    setNearbyPlaces([]);
    setNearbyExpanded(false);

    let pos = currentPos;
    const posIsFresh = pos?.ts && (Date.now() - pos.ts) < FRESH_POS_MAX_AGE_MS;

    try {
      if (!posIsFresh) {
        pos = await getCurrentLocation();
        if (nearbyStopRef.current) { setNearbyLoading(false); return; }
        setCurrentPos(pos);
      }
      const catWord = cat === "all" ? "essential places" : `${categoryWordFor(cat)}s`;
      speak(`Finding ${catWord} near you.`);
      const places = await searchNearbyPlaces(cat, pos.lat, pos.lon, { radiusKm: 10 });
      if (nearbyStopRef.current) return;
      if (!places || places.length === 0) {
        const msg = `No ${catWord} found near your location.`;
        setNearbyPlaces([]);
        setNearbyError(msg);
        speak(msg);
        return;
      }
      const labelled = withLabels(places);
      setNearbyPlaces(labelled);
      setNearbyCategory(cat);
      speakNearbyPlaces(labelled, cat);
    } catch (err) {
      let msg = err.message || "Could not find nearby places. Please try again.";
      if (/denied|allow location|need your location/i.test(msg)) {
        msg = "I need your location to find nearby places. Please allow location access in your browser.";
      }
      setNearbyError(msg);
      speak(msg);
    } finally {
      setNearbyLoading(false);
      if (!nearbyStopRef.current) setNearbySearched(true);
    }
  };

  /* Voice-friendly category word for one place, e.g. "hospital" / "pharmacy" */
  const categoryWordFor = (amenity) =>
    (NEARBY_CATEGORIES.find(c => c.key === amenity)?.label || (amenity || "place").replace(/_/g, " ")).toLowerCase();

  /* Same as the shared speak() from AccessibilityContext, but lets the caller
     know when the utterance has actually finished — needed so we can safely
     open the mic for a follow-up command only AFTER speech ends, never while
     it's still talking. Built locally (not by changing AccessibilityContext)
     to keep this fix contained to this file. */
  const speakWithCallback = (text, onDone) => {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.language;
    u.rate = settings.voiceSpeed;
    u.volume = 1;
    let done = false;
    const finish = () => { if (done) return; done = true; onDone?.(); };
    u.onend = finish;
    u.onerror = finish;
    // Safety net in case onend/onerror never fire (seen on some browsers for
    // long utterances) — same style of fallback already used for Zara's
    // greeting in DashboardLayout.
    setTimeout(finish, Math.max(4000, text.length * 90));
    window.speechSynthesis.speak(u);
  };

  /* Announce nearest places by voice, with A/B/C labels matching the sorted
     order shown in the cards — A is always the nearest result. Ends with a
     prompt so a blind user can act on the list without touching anything:
     "Nearby hospitals found. A, Saveetha Medical College Hospital, 1.2
     kilometres away. B, ... Say navigate to A, B, or C."
     Pass onDone to be notified once the announcement has actually finished
     playing (used to re-open the mic for "navigate to A/B/C" right after). */
  const speakNearbyPlaces = (places, cat, { withPrompt = true, onDone } = {}) => {
    if (!places || !places.length) { speak("No nearby places found."); onDone?.(); return; }
    const top = places.slice(0, 3);
    const catLabel = cat === "all" ? "places" : `${categoryWordFor(cat)}s`;
    let text = `Found ${places.length} nearby ${catLabel}. `;
    top.forEach((p, i) => {
      const label = p.label || letterLabel(i);
      const distLabel = p.formattedDist || (p.distM == null ? "" :
        p.distM < 1000 ? `${Math.round(p.distM)} metres away` : `${(p.distM / 1000).toFixed(1)} kilometres away`);
      text += `Option ${label}: ${p.name}, ${distLabel}. `;
    });
    if (withPrompt && top.length >= 1) {
      text += `Say navigate to ${top.map((p, i) => p.label || letterLabel(i)).join(", ")}.`;
    }
    if (onDone) speakWithCallback(text, onDone);
    else speak(text);
  };

  /* ─────────────────────────────────────────────────────────────────────────
     OSRM & OPENSTREETMAP ROUTE FETCH — strictly zero API keys.
     Uses mode.endpoints:
     - For "foot": OpenStreetMap Germany routed-foot (routes through authentic pedestrian
       alleys, footways, walkways, and subways) with failover to OSRM.
     - For "cycling": routed-bike with failover to OSRM.
     - For "driving": OSRM driving with failover to routed-car.
  ───────────────────────────────────────────────────────────────────────── */
  const fetchOsrmRoute = async (fromLat, fromLon, toLat, toLon, modeKeyOrProfile = "driving") => {
    const mode = MODES.find(m =>
      m.key === modeKeyOrProfile ||
      m.osrm === modeKeyOrProfile ||
      m.label.toLowerCase() === String(modeKeyOrProfile).toLowerCase()
    ) || MODES[0];

    const endpoints = mode.endpoints || ["https://router.project-osrm.org/route/v1/driving"];
    let lastError = null;

    for (const base of endpoints) {
      const url =
        `${base}/${fromLon},${fromLat};${toLon},${toLat}` +
        `?steps=true&overview=full&geometries=geojson&annotations=false&continue_straight=false`;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(url, { signal: ctrl.signal });
        const data = await safeJson(res);
        if (data.code === "Ok" && data.routes?.length) {
          return data.routes[0];
        }
        lastError = new Error(data.message || "No route found on this mapping server.");
      } catch (err) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new Error("No route found. Try a different transport mode.");
  };

  /* ─────────────────────────────────────────────────────────────────────────
     BUILD STEP LIST from OSRM route
     Each step includes the maneuver waypoint [lon,lat] for GPS tracking.
  ───────────────────────────────────────────────────────────────────────── */
  const buildSteps = (osrmRoute) =>
    osrmRoute.legs[0].steps.map(s => ({
      instruction: getInstruction(s.maneuver),
      icon:        getIcon(s.maneuver),
      name:        s.name,
      distance:    s.distance,
      duration:    s.duration,
      type:        s.maneuver?.type,
      /* waypoint at which this step's maneuver occurs */
      wpLat:       s.maneuver?.location?.[1] ?? null,
      wpLon:       s.maneuver?.location?.[0] ?? null,
    }));

  /* ─────────────────────────────────────────────────────────────────────────
     NAVIGATION SPEECH HELPERS
     All navigation speech is non-interrupting EXCEPT:
     - speakNav() cancels prior nav utterance before speaking
  ───────────────────────────────────────────────────────────────────────── */
  const speakNav = useCallback((text) => {
    // speak() from AccessibilityContext already calls speechSynthesis.cancel()
    speak(text);
  }, [speak]);

  /* ─────────────────────────────────────────────────────────────────────────
     STOP NAVIGATION
  ───────────────────────────────────────────────────────────────────────── */
  const stopNavigation = useCallback(() => {
    stopRef.current = true;
    navActiveRef.current = false;
    if (watchIdRef.current !== null) {
      navigator.geolocation?.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    window.speechSynthesis.cancel();
    setNavActive(false);
    setNavStatus("idle");
    setCurrentStepIdx(0);
    setStepStates([]);
    setDistToNext(null);
    rerouting.current = false;
  }, []);

  /* Full reset — route, route status, nearby places/loading/error/search
     state, and any active GPS/navigation — used by both the Clear button
     and the "clear navigation" voice command so they can never drift apart. */
  const clearNavigation = useCallback(() => {
    stopNavigation();
    stopRef.current = true;
    nearbyStopRef.current = true; // cancels any in-flight nearby-places search
    setRouteStatus("idle");
    setRoute(null);
    routeRef.current = null;
    setDestination("");
    setStartLocation("");
    setNearbyPlaces([]);
    setNearbyLoading(false);
    setNearbyError("");
    setNearbySearched(false);
    setErrorMsg("");
    setNavStatus("idle");
    speak("Route cleared.");
  }, [stopNavigation, speak]);

  /* ─────────────────────────────────────────────────────────────────────────
     GPS POSITION UPDATE HANDLER
     Called by watchPosition on every GPS fix.
  ───────────────────────────────────────────────────────────────────────── */
  const handleGpsUpdate = useCallback((pos) => {
    if (!navActiveRef.current) return;

    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    if (!isValidCoordinate(lat, lon)) return;

    const accInfo = classifyAccuracy(accuracy);
    setLivePos({
      lat,
      lon,
      accuracy: accInfo.accuracy,
      accuracyTier: accInfo.tier,
      accuracyLabel: accInfo.label,
    });

    const steps     = routeRef.current?.steps;
    const dest      = destRef.current;
    if (!steps?.length) return;

    const idx   = currentStepIdxRef.current;
    const step  = steps[idx];
    if (!step) return;

    /* ── Check arrival (enforces near-final-step check to avoid premature trigger) ── */
    const arrivalDist = haversineM(lat, lon, dest.lat, dest.lon);
    if (checkArrivalEligibility(idx, steps.length, arrivalDist, ARRIVAL_DIST)) {
      navActiveRef.current = false;
      setNavActive(false);
      setNavStatus("arrived");
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      speakNav("You have arrived at your destination.");
      return;
    }

    /* ── Distance to current step waypoint ── */
    const distToWp = (step.wpLat != null && step.wpLon != null)
      ? haversineM(lat, lon, step.wpLat, step.wpLon)
      : null;

    if (distToWp !== null) setDistToNext(Math.round(distToWp));

    const states = [...stepStatesRef.current];

    /* ── Check if current step is completed (passed the waypoint) ── */
    if (distToWp !== null && distToWp < COMPLETE_DIST && step.type !== "arrive") {
      states[idx] = "completed";
      const nextIdx = idx + 1;
      if (nextIdx < steps.length) {
        currentStepIdxRef.current = nextIdx;
        setCurrentStepIdx(nextIdx);
        stepStatesRef.current = states;
        setStepStates([...states]);
        // Announce the new current step only if it's not the arrival step
        const nextStep = steps[nextIdx];
        if (nextStep && nextStep.type !== "arrive") {
          const road = nextStep.name ? ` on ${nextStep.name}` : "";
          speakNav(`${nextStep.instruction}${road}.`);
        }
        setNavStatus("active");
      }
      return;
    }

    /* ── Off-route detection with dynamic threshold to prevent sensor jitter loops ── */
    const dynamicThreshold = computeDynamicOffRouteThreshold(OFF_ROUTE_DIST, accuracy);
    if (distToWp !== null && dynamicThreshold !== Infinity && distToWp > dynamicThreshold * 3 && !rerouting.current) {
      // Only trigger if we are significantly off ALL nearby steps
      const nearAnyStep = steps.some((st, si) => {
        if (si <= idx || st.wpLat == null) return false;
        return haversineM(lat, lon, st.wpLat, st.wpLon) < dynamicThreshold * 3;
      });
      if (!nearAnyStep && distToWp > dynamicThreshold * 4) {
        rerouting.current = true;
        setNavStatus("off_route");
        speakNav("You are off route. Recalculating.");
        // Recalculate from current position
        const modeKey  = transportModeRef.current;
        fetchOsrmRoute(lat, lon, dest.lat, dest.lon, modeKey)
          .then(newOsrmRoute => {
            if (!navActiveRef.current) return;
            const newSteps = buildSteps(newOsrmRoute);
            const { duration, isEstimate } = estimateDuration(modeKey, newOsrmRoute.distance, newOsrmRoute.duration);
            const newRoute = {
              ...routeRef.current,
              distance: newOsrmRoute.distance,
              duration,
              durationIsEstimate: isEstimate,
              steps: newSteps,
            };
            routeRef.current = newRoute;
            setRoute(newRoute);
            const newStepStates = newSteps.map(() => "pending");
            currentStepIdxRef.current = 0;
            setCurrentStepIdx(0);
            stepStatesRef.current = newStepStates;
            setStepStates(newStepStates);
            rerouting.current = false;
            setNavStatus("active");
            if (newSteps[0]) speakNav(`Route updated. ${newSteps[0].instruction}.`);
          })
          .catch(() => {
            rerouting.current = false;
            setNavStatus("active");
          });
        return;
      }
    }

    /* ── Proximity-based voice announcements ── */
    if (distToWp !== null && step.type !== "depart" && step.type !== "arrive") {
      const currentState = states[idx] || "pending";

      if (currentState === "pending" && distToWp <= ANNOUNCE_DIST) {
        // First announcement: "Turn right in X m"
        states[idx] = "announced";
        stepStatesRef.current = states;
        setStepStates([...states]);
        setNavStatus("approaching");
        const road = step.name ? ` onto ${step.name}` : "";
        speakNav(`${step.instruction}${road} in ${fmtDist(distToWp)}.`);
      } else if (currentState === "announced" && distToWp <= FINAL_DIST) {
        // Final announcement: "Turn right now"
        states[idx] = "final";
        stepStatesRef.current = states;
        setStepStates([...states]);
        const road = step.name ? ` onto ${step.name}` : "";
        speakNav(`${step.instruction}${road} now.`);
      }
    }
  }, [speakNav]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─────────────────────────────────────────────────────────────────────────
     START LIVE GPS TRACKING
  ───────────────────────────────────────────────────────────────────────── */
  const startGpsTracking = useCallback(() => {
    if (!navigator.geolocation) {
      speak("Location access is required for live navigation.");
      return;
    }
    // Clear any existing watch
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGpsUpdate,
      (err) => {
        let msg = "GPS signal lost.";
        if (err.code === 1) msg = "Location access is required for live navigation. Please allow location access.";
        else if (err.code === 3) msg = "GPS timeout. Check your connection.";
        setNavStatus("idle");
        speak(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  }, [handleGpsUpdate, speak]);

  /* ─────────────────────────────────────────────────────────────────────────
     START ACTIVE NAVIGATION (after route is loaded)
  ───────────────────────────────────────────────────────────────────────── */
  const startActiveNavigation = (routeData) => {
    if (!routeData?.steps?.length) return;
    stopRef.current = false;
    navActiveRef.current = true;

    const initialStates = routeData.steps.map(() => "pending");
    stepStatesRef.current = initialStates;
    currentStepIdxRef.current = 0;

    setNavActive(true);
    setNavStatus("active");
    setCurrentStepIdx(0);
    setStepStates(initialStates);
    setDistToNext(null);

    // Speak first step
    const first = routeData.steps[0];
    if (first) {
      const road = first.name ? ` on ${first.name}` : "";
      speakNav(`Navigation started. ${first.instruction}${road}.`);
    }

    startGpsTracking();
  };

  /* ─────────────────────────────────────────────────────────────────────────
     SHARED ROUTE BUILDER — given a fresh position and KNOWN destination
     coordinates, computes the OSRM route, saves it, and speaks the required
     accessibility-format summary. Used by every flow that already knows
     exactly where it's going (geocoded destination, "navigate to A/B/C",
     "navigate to the nearest X") so this logic — and its correctness fixes —
     live in exactly one place.
  ───────────────────────────────────────────────────────────────────────── */
  const buildAndSpeakRoute = async (pos, destLat, destLon, destLabel, mode, reqToken) => {
    setRouteStatus("routing");
    speak("Calculating route.");
    const osrmRoute = await fetchOsrmRoute(pos.lat, pos.lon, destLat, destLon, mode.key);
    if (stopRef.current) return;
    // A newer route request (e.g. the user re-clicked Get Route, or picked a
    // different transport mode, before this one finished) has since started
    // — never let this slower/stale one win and overwrite its result.
    if (reqToken !== routeReqRef.current) return;

    const steps = buildSteps(osrmRoute);

    /* OSRM & routed-foot duration estimation */
    const { duration, isEstimate } = estimateDuration(mode.key, osrmRoute.distance, osrmRoute.duration);

    const routeData = {
      distance:  osrmRoute.distance,
      duration,
      durationIsEstimate: isEstimate,
      // Car's duration comes directly from the routing engine (not our own
      // estimate), so it must not be labelled "estimated" — but OSRM's
      // public routing has no live traffic data, so it's a free-flow time,
      // not a Google-Maps-style traffic-aware ETA. Flagged separately so
      // the UI/voice can say so honestly without touching the est. label.
      noLiveTraffic: mode.key === "driving",
      steps,
      destLabel,
      fromLabel: pos.label,
      mode:      mode.label,
      modeKey:   mode.key,
      _destLat:  destLat,
      _destLon:  destLon,
      _fromLat:  pos.lat,
      _fromLon:  pos.lon,
    };

    routeRef.current = routeData;
    destRef.current  = { lat: destLat, lon: destLon, label: destLabel };

    setRoute(routeData);
    setRouteStatus("done");

    /* Save to backend (best-effort — never blocks the loading state) */
    API.post("/navigation", { destination: destLabel }).catch(() => {});
    API.get("/navigation").then(res => setRequests(res.data)).catch(() => {});

    /* Announce route summary. distance/duration are always real numbers here
       (fetchOsrmRoute already threw if OSRM didn't return "Ok") so this can
       never speak "undefined" or "NaN". */
    const distKm  = (osrmRoute.distance / 1000).toFixed(1);
    const minutes = Math.max(1, Math.round(duration / 60));
    const timePhrase = isEstimate ? `approximately ${minutes} minutes` : `${minutes} minutes`;
    const eta = fmtETA(duration);
    const trafficNote = routeData.noLiveTraffic
      ? " This does not include live traffic — actual time may be longer."
      : "";
    const startNotice = pos.isManual ? "Using manual start location. " : "";
    speak(
      `${startNotice}${mode.label} route to ${destLabel}. Distance is ${distKm} kilometres. ` +
      `Estimated travel time is ${timePhrase}.${trafficNote} Arriving at approximately ${eta}. ` +
      (pos.isManual ? "Turn-by-turn route steps are displayed below." : "Press Start Navigation to begin GPS guidance.")
    );
  };

  /* ─────────────────────────────────────────────────────────────────────────
     MAIN ROUTE FUNCTION
     "X near me" → searches, sorts by real Haversine distance from a FRESH
     GPS fix, labels A/B/C, and speaks the list + a "say navigate to A/B/C"
     prompt. It does NOT silently auto-pick one — a blind user chooses via
     "navigate to A" / "navigate to the nearest X" next (see below).
     A normal named destination still geocodes and routes directly, as before.
  ───────────────────────────────────────────────────────────────────────── */
  const startRoute = async (dest = destination) => {
    if (!dest.trim()) { speak("Please enter a destination."); return; }

    // Stop any existing navigation BEFORE clearing the cancel flags — order
    // matters here: stopNavigation() itself sets stopRef.current = true, so
    // it must run first, or it would immediately re-cancel the fresh search
    // we're about to start and every route would silently abort right after
    // its first `if (stopRef.current) return` check (this was the actual
    // cause of routes getting permanently stuck on "Getting route…").
    stopNavigation();
    stopRef.current = false;
    nearbyStopRef.current = false; // this is a fresh, intentional search — un-cancel nearby writes
    const reqToken = ++routeReqRef.current; // this call is now the only one allowed to commit a route

    setRoute(null);
    setErrorMsg("");

    const mode = MODES.find(m => m.key === transportMode);

    /* "X near me" → find + sort + label + speak, then wait for a follow-up
       voice command. Handled first so it never falls through to geocoding. */
    if (NEAR_ME_RE.test(dest)) {
      const tag = amenityFromQuery(dest);
      if (!tag) {
        setRouteStatus("error");
        const msg = "Could not identify place type. Try 'hospital near me' or 'pharmacy near me'.";
        setErrorMsg(msg);
        speak(msg);
        return;
      }
      if (window._vgPauseWake) { try { await window._vgPauseWake(); } catch {} }
      let announced = false;
      try {
        await withTimeout((async () => {
          setRouteStatus("locating");
          speak(`Finding nearest ${tag.replace(/_/g, " ")} near you.`);
          const pos = await getCurrentLocation();
          setCurrentPos(pos);
          if (stopRef.current) return;

          setRouteStatus("routing");
          const places = await searchNearbyPlaces(tag, pos.lat, pos.lon, { radiusKm: 10 });
          if (stopRef.current) return;

          if (!places || places.length === 0) {
            throw new Error(`I could not find any ${tag.replace(/_/g, " ")} near your location.`);
          }

          const labelled = withLabels(places);
          setNearbyPlaces(labelled);
          setNearbyCategory(tag);
          setNearbyExpanded(false);
          setNearbyError("");
          setNearbyLoading(false);
          setNearbySearched(true);

          setRouteStatus("idle");
          announced = true;
          speakNearbyPlaces(labelled, tag, { onDone: listenForFollowUp });
        })(), 15000, "Finding nearby places took too long. Please try again.");
      } catch (err) {
        setRouteStatus("error");
        const msg = err.message || "Could not find nearby places. Check internet and try again.";
        setErrorMsg(msg);
        speak(msg);
      } finally {
        if (!announced && window._vgResumeWake) { try { window._vgResumeWake(); } catch {} }
      }
      return;
    }

    try {
      // Backstop: no matter which internal await misbehaves, this guarantees
      // routeStatus reaches "error" (never left on "locating"/"geocoding"/
      // "routing") within a bounded time.
      await withTimeout((async () => {
        /* Step 1 — Get start position (manual start location or live GPS) */
        let pos = null;
        if (startLocation.trim()) {
          setRouteStatus("geocoding");
          speak(`Finding starting location ${startLocation}.`);
          const startCoords = await geocode(startLocation.trim());
          pos = {
            lat: startCoords.lat,
            lon: startCoords.lon,
            label: startCoords.label,
            isManual: true,
            accuracy: null,
            accuracyTier: "manual",
            countryCode: "",
            ts: Date.now(),
          };
          setCurrentPos(pos);
        } else {
          setRouteStatus("locating");
          speak("Getting your current location.");
          pos = await getCurrentLocation();
          setCurrentPos(pos);
          if (pos.accuracyAdvisory) {
            speak(pos.accuracyAdvisory);
          }
        }
        if (stopRef.current) return;

        /* Step 2 — Resolve destination */
        setRouteStatus("geocoding");
        speak(`Finding ${dest} on the map.`);
        const destCoords = await geocode(dest, pos.lat, pos.lon, pos.countryCode || "");
        if (stopRef.current) return;

        /* Sanity check */
        const sanityDist = haversineKm(pos.lat, pos.lon, destCoords.lat, destCoords.lon);
        if (sanityDist > 300) {
          throw new Error(
            `Found "${destCoords.label}" but it is ${sanityDist.toFixed(0)} km away — likely wrong. ` +
            `Add your city name, e.g. "${dest}, Chennai".`
          );
        }

        /* Step 3 — OSRM routing + speech */
        await buildAndSpeakRoute(pos, destCoords.lat, destCoords.lon, destCoords.label, mode, reqToken);
        if (stopRef.current) return;

        /* Fetch nearby places around USER (not destination) */
        fetchNearbyPlaces(pos.lat, pos.lon);
        setNearbyCategory("all");
        setNearbyExpanded(false);
      })(), 45000, "This is taking too long. Please check your internet connection and try again.");

    } catch (err) {
      setRouteStatus("error");
      const msg = /gateway.?timeout|504/i.test(err.message || "")
        ? "The mapping service is temporarily busy. Please try again in a moment."
        : (err.message || "Could not get route. Check internet and try again.");
      setErrorMsg(msg);
      speak(msg);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     ROUTE DIRECTLY TO A KNOWN COORDINATE (a card, or "navigate to A/B/C")
     Skips geocoding entirely — we already know exactly where this place is
     from the Overpass search, so re-searching it by name (which could match
     a different, same-named place) would be both slower and less reliable.
  ───────────────────────────────────────────────────────────────────────── */
  const startRouteToCoords = async (destLat, destLon, destLabel) => {
    // stopNavigation() must run BEFORE the flags below are cleared — it sets
    // stopRef.current = true itself, so clearing it first would just get
    // immediately re-cancelled and the route would silently never complete.
    stopNavigation();
    stopRef.current = false;
    nearbyStopRef.current = false;
    const reqToken = ++routeReqRef.current; // this call is now the only one allowed to commit a route
    setRoute(null);
    setErrorMsg("");
    setDestination(destLabel);

    const mode = MODES.find(m => m.key === transportMode);

    try {
      await withTimeout((async () => {
        let pos = null;
        if (startLocation.trim()) {
          setRouteStatus("geocoding");
          speak(`Finding starting location ${startLocation}.`);
          const startCoords = await geocode(startLocation.trim());
          pos = {
            lat: startCoords.lat,
            lon: startCoords.lon,
            label: startCoords.label,
            isManual: true,
            accuracy: null,
            accuracyTier: "manual",
            countryCode: "",
            ts: Date.now(),
          };
          setCurrentPos(pos);
        } else {
          setRouteStatus("locating");
          speak("Getting your current location.");
          pos = await getCurrentLocation();
          setCurrentPos(pos);
          if (pos.accuracyAdvisory) {
            speak(pos.accuracyAdvisory);
          }
        }
        if (stopRef.current) return;
        await buildAndSpeakRoute(pos, destLat, destLon, destLabel, mode, reqToken);
      })(), 25000, "This is taking too long. Please check your internet connection and try again.");
    } catch (err) {
      setRouteStatus("error");
      const msg = err.message || "Could not get route. Check internet and try again.";
      setErrorMsg(msg);
      speak(msg);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     "NAVIGATE TO THE NEAREST X" — search + route in one step, for when the
     user wants to just go, not choose from a list.
  ───────────────────────────────────────────────────────────────────────── */
  const navigateToNearest = async (phraseRaw) => {
    const phrase = phraseRaw.trim();
    const tag = amenityFromQuery(phrase) || amenityFromQuery(`${phrase} near me`);
    if (!tag) {
      speak(`I couldn't identify what kind of place "${phrase}" is. Try "navigate to the nearest hospital".`);
      return;
    }

    // stopNavigation() must run BEFORE the flags below are cleared — see the
    // comment in startRoute() for why the order matters.
    stopNavigation();
    stopRef.current = false;
    nearbyStopRef.current = false;
    const reqToken = ++routeReqRef.current; // this call is now the only one allowed to commit a route
    setRoute(null);
    setErrorMsg("");

    const mode = MODES.find(m => m.key === transportMode);

    try {
      await withTimeout((async () => {
        setRouteStatus("locating");
        speak(`Finding nearest ${tag.replace(/_/g, " ")} near you.`);
        const pos = await getCurrentLocation();
        setCurrentPos(pos);
        if (stopRef.current) return;

        setRouteStatus("routing");
        const places = await searchNearbyPlaces(tag, pos.lat, pos.lon, { radiusKm: 10 });
        if (stopRef.current) return;
        if (!places || places.length === 0) {
          throw new Error(`No ${tag.replace(/_/g, " ")} found near you.`);
        }
        const nearest = places[0];
        setDestination(nearest.name);

        const labelled = withLabels(places);
        setNearbyPlaces(labelled);
        setNearbyCategory(tag);
        setNearbyExpanded(false);
        setNearbyError("");
        setNearbyLoading(false);
        setNearbySearched(true);

        await buildAndSpeakRoute(pos, nearest.lat, nearest.lon, nearest.name, mode, reqToken);
      })(), 20000, "Finding or routing to the nearest place took too long. Please try again.");
    } catch (err) {
      setRouteStatus("error");
      const msg = err.message || "Could not find or route to the nearest place. Check internet and try again.";
      setErrorMsg(msg);
      speak(msg);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     SPEAK FULL ROUTE SUMMARY (manual re-read button)
  ───────────────────────────────────────────────────────────────────────── */
  const speakRoute = (r = route) => {
    if (!r) return;
    const distKm = (r.distance / 1000).toFixed(1);
    const time   = fmtTime(r.duration);
    const eta    = fmtETA(r.duration);
    let text = `${r.mode} route from ${r.fromLabel} to ${r.destLabel}. `;
    text += r.durationIsEstimate
      ? `Total distance: ${distKm} kilometres. Estimated time: approximately ${time} — route time unavailable for this mode, so this is a distance-based estimate, not an exact routed time. Arriving at approximately ${eta}. `
      : `Total distance: ${distKm} kilometres. Estimated time: ${time}. Arriving at ${eta}. `;
    text += `${r.steps.length} steps. `;
    r.steps.forEach((s, i) => {
      if (s.type === "arrive") { text += `Finally, arrive at your destination. `; return; }
      const road = s.name ? ` onto ${s.name}` : "";
      const dist = s.distance > 5 ? ` for ${fmtDist(s.distance)}` : "";
      text += `Step ${i + 1}: ${s.instruction}${road}${dist}. `;
    });
    speak(text);
  };

  /* ─────────────────────────────────────────────────────────────────────────
     VOICE INPUT
  ───────────────────────────────────────────────────────────────────────── */
  /* Follow-up voice commands that operate on the CURRENT nearby-places list,
     so a blind user never has to touch a card. Anything not matched here
     falls through to the existing "treat it as a destination" behavior. */
  const handleVoiceFollowUp = (transcriptRaw) => {
    const t = transcriptRaw.trim().toLowerCase();

    if (/^stop$/.test(t)) {
      stopNavigation();
      speak("Navigation stopped.");
      return true;
    }

    if (/^clear( navigation| route)?$/.test(t)) {
      clearNavigation();
      return true;
    }

    if (/^read nearby( places)?$/.test(t) || /^read (the )?results$/.test(t)) {
      const list = nearbyCategory === "all" ? nearbyPlaces : nearbyPlaces.filter(p => p.amenity === nearbyCategory);
      // Pause the background wake-word listener for this announcement too —
      // same reason as the main "X near me" flow (see startRoute): left
      // running, it can pick up the TTS itself and cut the list off early.
      // listenForFollowUp resumes it once the list has actually finished
      // playing, and re-opens the mic for "navigate to A/B/C" in the process.
      (async () => {
        if (window._vgPauseWake) { try { await window._vgPauseWake(); } catch {} }
        speakNearbyPlaces(list, nearbyCategory, { onDone: listenForFollowUp });
      })();
      return true;
    }

    const useModeMatch = t.match(/^use (car|bike|bicycle|cycling|walk|walking|foot)$/);
    if (useModeMatch) {
      const word = useModeMatch[1];
      const key = /^(bike|bicycle|cycling)$/.test(word) ? "cycling"
        : /^(walk|walking|foot)$/.test(word) ? "foot"
        : "driving";
      setTransportMode(key);
      speak(`Transport mode set to ${MODES.find(m => m.key === key)?.label || key}.`);
      return true;
    }

    const nearestMatch = t.match(/^navigate to (the )?nearest (.+)$/);
    if (nearestMatch) {
      navigateToNearest(nearestMatch[2]);
      return true;
    }

    const letterMatch = t.match(/^navigate to ([a-z])\b/) || t.match(/^go to ([a-z])\b/);
    if (letterMatch) {
      const list = nearbyCategory === "all" ? nearbyPlaces : nearbyPlaces.filter(p => p.amenity === nearbyCategory);
      const wanted = letterMatch[1].toUpperCase();
      const place = list.find(p => (p.label || "").toUpperCase() === wanted);
      if (place) {
        startRouteToCoords(place.lat, place.lon, place.name);
      } else {
        speak(`I don't have a place labelled ${wanted}. Say "read nearby places" to hear the current list.`);
      }
      return true;
    }

    return false;
  };

  /* Shared by the manual mic button AND the auto-reopened follow-up listener
     below, so "navigate to A" is handled identically no matter which one
     captured it. */
  const handleTranscript = (transcript) => {
    if (handleVoiceFollowUp(transcript)) return;
    const dest = transcript;
    setDestination(dest);
    setTimeout(() => startRoute(dest), 400);
  };

  /* Re-opens the mic for ONE follow-up command right after the nearby-places
     list finishes being spoken, so "navigate to A" works without the user
     pressing the mic button (or saying the wake word) again. Always ends by
     resuming the background wake-word listener, whether it heard something,
     errored, or timed out — so it can never get stuck disabled. This is a
     single one-shot listen, not a loop: whatever command it captures is
     handled exactly like a normal manual mic press and nothing re-arms
     itself afterward. */
  const listenForFollowUp = () => {
    const resumeWake = () => { if (window._vgResumeWake) { try { window._vgResumeWake(); } catch {} } };

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    // Don't start a second recognizer if one is already active (manual mic
    // press, or an overlapping follow-up window) — just hand control back.
    if (!SR || voiceListening || followUpActiveRef.current) { resumeWake(); return; }

    followUpActiveRef.current = true;
    let handled = false;
    const finish = () => {
      if (handled) return;
      handled = true;
      followUpActiveRef.current = false;
      setVoiceListening(false);
      resumeWake();
    };

    // Small delay before opening the mic so it doesn't catch the tail end of
    // the announcement itself as input.
    setTimeout(() => {
      if (stopRef.current) { finish(); return; } // Clear/Stop happened while we were waiting
      const rec = new SR();
      rec.lang = settings.language;
      rec.continuous = false;
      rec.interimResults = false;
      recRef.current = rec;

      // Safety timeout — if the user says nothing, don't leave the mic (and
      // the paused wake-word listener) hanging indefinitely.
      const timeout = setTimeout(() => { try { rec.stop(); } catch {} finish(); }, 8000);

      rec.onresult = (e) => {
        if (handled) return;
        handled = true;
        clearTimeout(timeout);
        followUpActiveRef.current = false;
        setVoiceListening(false);
        resumeWake();
        handleTranscript(e.results[0][0].transcript.trim());
      };
      rec.onerror = () => { clearTimeout(timeout); finish(); };
      rec.onend   = () => { clearTimeout(timeout); finish(); };

      try {
        rec.start();
        setVoiceListening(true);
      } catch {
        finish();
      }
    }, 400);
  };

  const startVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { speak("Voice input not supported. Please use Chrome."); return; }
    if (voiceListening) { recRef.current?.stop(); setVoiceListening(false); return; }
    const rec = new SR();
    rec.lang = settings.language;
    rec.continuous = false;
    rec.interimResults = false;
    recRef.current = rec;
    rec.start();
    setVoiceListening(true);
    speak("Say your destination, or a command like navigate to A, read nearby places, or stop.");
    rec.onresult = (e) => {
      const transcript = e.results[0][0].transcript.trim();
      setVoiceListening(false);
      handleTranscript(transcript);
    };
    rec.onerror  = () => { setVoiceListening(false); speak("Could not understand. Try again."); };
    rec.onend    = () => setVoiceListening(false);
  };

  const openInMaps = (dest = destination) => {
    if (!dest) return;
    const travelmode = MODES.find(m => m.key === transportMode)?.travelmode || "driving";
    if (currentPos) {
      window.open(`https://www.google.com/maps/dir/?api=1&origin=${currentPos.lat},${currentPos.lon}&destination=${encodeURIComponent(dest)}&travelmode=${travelmode}`, "_blank");
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`, "_blank");
    }
  };

  const deleteRequest = async (id) => {
    try {
      await API.delete(`/navigation/${id}`);
      setRequests(p => p.filter(r => r.id !== id));
    } catch {}
  };

  /* ─────────────────────────────────────────────────────────────────────────
     STATUS LABEL
  ───────────────────────────────────────────────────────────────────────── */
  const statusLabel = {
    idle:         null,
    locating:     "📡 Getting your location…",
    geocoding:    "🔍 Finding destination…",
    routing:      "🗺️ Calculating best route…",
    done:         null,
    error:        null,
  }[routeStatus];

  /* ─────────────────────────────────────────────────────────────────────────
     NAVIGATION STATUS DISPLAY
  ───────────────────────────────────────────────────────────────────────── */
  const navStatusConfig = {
    idle:          { label: "",                              color: C.sub,      bg: "transparent" },
    active:        { label: "🧭 Navigation active",          color: "#22c55e",  bg: "rgba(34,197,94,0.1)"  },
    approaching:   { label: "⚠️ Approaching turn",           color: "#f59e0b",  bg: "rgba(245,158,11,0.1)" },
    arrived:       { label: "🏁 Arrived at destination",     color: "#22c55e",  bg: "rgba(34,197,94,0.15)" },
    off_route:     { label: "⚠️ Off route — recalculating", color: "#ef4444",  bg: "rgba(239,68,68,0.1)"  },
    recalculating: { label: "🔄 Recalculating route…",       color: "#60a5fa",  bg: "rgba(96,165,250,0.1)" },
  };
  const nsConfig = navStatusConfig[navStatus] || navStatusConfig.idle;

  /* ─────────────────────────────────────────────────────────────────────────
     CURRENT + NEXT STEP DISPLAY
  ───────────────────────────────────────────────────────────────────────── */
  const currentStep = route?.steps?.[currentStepIdx] || null;
  const nextStep    = route?.steps?.[currentStepIdx + 1] || null;

  /* ─────────────────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────────────────── */
  return (
    <DashboardLayout>
      <div className="fade-in">
        <div className="page-header">
          <h1>🗺️ Navigation</h1>
          <p>
            Voice-guided turn-by-turn routing. Say{" "}
            <strong>"Hey Zara, navigate to school"</strong> or use controls below.
          </p>
        </div>

        {errorMsg   && <div className="alert alert-error"  role="alert">{errorMsg}</div>}
        {statusLabel && <div className="alert alert-info">{statusLabel}</div>}

        {/* ── Input card ── */}
        <div className="card" style={{ marginBottom: "20px" }}>
          {/* Starting Location (Optional / GPS fallback) */}
          <div style={{ marginBottom: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <label style={{ ...s.sec, color: C.text, fontSize: "14px", margin: 0 }}>
                📍 Start Location
              </label>
              {startLocation ? (
                <button
                  type="button"
                  onClick={() => { setStartLocation(""); speak("Using live GPS location."); }}
                  style={{ background: "none", border: "none", color: "#a78bfa", fontSize: "12px", cursor: "pointer", fontWeight: 600 }}
                >
                  🔄 Reset to My GPS
                </button>
              ) : (
                <span style={{ fontSize: "11px", color: C.sub }}>
                  {currentPos?.accuracy ? `GPS ±${currentPos.accuracy}m (${currentPos.accuracyTier || "normal"})` : "Defaults to Live GPS"}
                </span>
              )}
            </div>
            <input
              style={{ ...s.input, background: C.input, border: `1.5px solid ${C.inBd}`, color: C.text, width: "100%" }}
              type="text"
              placeholder="Leave empty for live GPS, or type starting address"
              value={startLocation}
              onChange={e => setStartLocation(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startRoute()}
              aria-label="Starting Location"
            />
          </div>

          <h3 style={{ ...s.sec, color: C.text, fontSize: "14px" }}>🎯 Destination</h3>
          <div style={s.inputRow}>
            <input
              style={{ ...s.input, background: C.input, border: `1.5px solid ${C.inBd}`, color: C.text, flex: 1 }}
              type="text"
              placeholder='e.g. "school", "Chennai airport", "hospital near me"'
              value={destination}
              onChange={e => setDestination(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startRoute()}
              aria-label="Destination"
            />
            <button
              onClick={startVoiceInput}
              style={{ ...s.voiceBtn, ...(voiceListening ? s.voiceBtnActive : {}) }}
              aria-label={voiceListening ? "Stop voice input" : "Voice input"}
              title="Speak destination"
            >
              {voiceListening ? "⏹" : "🎤"}
            </button>
          </div>

          {/* Transport mode */}
          <div style={{ marginTop: "14px" }}>
            <div style={{ fontSize: "12px", color: C.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "10px" }}>
              Transport Mode
            </div>
            <div style={s.modeRow}>
              {MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setTransportMode(m.key)}
                  style={{
                    ...s.modeBtn,
                    ...(transportMode === m.key ? s.modeBtnActive : {}),
                    borderColor: transportMode === m.key ? "#a78bfa" : C.inBd,
                    color:       transportMode === m.key ? "#a78bfa" : C.sub,
                    background:  transportMode === m.key ? "rgba(167,139,250,0.12)" : C.input,
                  }}
                  aria-label={`${m.label} transport mode`}
                  aria-pressed={transportMode === m.key}
                >
                  <span style={{ fontSize: "22px" }}>{m.icon}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700 }}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "10px", marginTop: "16px", flexWrap: "wrap" }}>
            <button
              onClick={() => startRoute()}
              disabled={["locating","geocoding","routing"].includes(routeStatus) || !destination.trim()}
              style={s.routeBtn}
              aria-label="Get route"
            >
              {["locating","geocoding","routing"].includes(routeStatus)
                ? "⏳ Getting route…"
                : "🗺️ Get Route"}
            </button>

            {/* Start / Stop Navigation */}
            {route && !navActive && navStatus !== "arrived" && (
              <button
                onClick={() => startActiveNavigation(route)}
                style={s.startNavBtn}
                aria-label="Start GPS navigation"
              >
                🧭 Start Navigation
              </button>
            )}
            {navActive && (
              <button
                onClick={() => { stopNavigation(); speak("Navigation stopped."); }}
                style={s.stopNavBtn}
                aria-label="Stop navigation"
              >
                ⏹ Stop Navigation
              </button>
            )}

            <button
              onClick={() => openInMaps()}
              disabled={!destination.trim()}
              style={s.mapsBtn}
              aria-label="Open in Google Maps"
            >
              📍 Open in Maps
            </button>

            {route && (
              <button onClick={() => speakRoute()} style={s.speakBtn} aria-label="Speak full route">
                🔊 Speak Route
              </button>
            )}

            {(routeStatus !== "idle" || route || nearbyLoading || nearbyError || nearbyPlaces.length > 0) && (
              <button
                onClick={clearNavigation}
                style={s.clearBtn}
                aria-label="Clear route"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* ── NEARBY PLACES — standalone section (works without a route) ── */}
        <div className="card" style={{ marginBottom: "20px" }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h3 style={{ ...s.sec, color: C.text, marginBottom: 0 }}>📍 Nearby Places</h3>
              {nearbyLoading && (
                <span style={{ fontSize: "12px", color: "#a78bfa" }}>📡 Finding places near you…</span>
              )}
              {!nearbyLoading && nearbyPlaces.length > 0 && (
                <span style={{ fontSize: "11px", color: C.sub }}>sorted nearest first</span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {nearbyPlaces.length > 0 && (
                <button
                  onClick={async () => {
                    const list = nearbyCategory === "all" ? nearbyPlaces : nearbyPlaces.filter(p => p.amenity === nearbyCategory);
                    if (window._vgPauseWake) { try { await window._vgPauseWake(); } catch {} }
                    speakNearbyPlaces(list, nearbyCategory, { onDone: listenForFollowUp });
                  }}
                  style={{ ...s.speakBtn, padding: "8px 14px", fontSize: "13px" }}
                  aria-label="Read nearby places aloud"
                >
                  🔊 Read Nearby Places
                </button>
              )}
              <button
                onClick={() => { setNearbyCategory("all"); findNearbyPlaces("all"); }}
                disabled={nearbyLoading}
                style={{
                  background: "#a78bfa", color: "#000", border: "none",
                  padding: "8px 16px", borderRadius: "10px", fontWeight: 700,
                  fontSize: "13px", cursor: nearbyLoading ? "not-allowed" : "pointer",
                  fontFamily: "Inter,Arial,sans-serif", opacity: nearbyLoading ? 0.6 : 1,
                }}
                aria-label="Find places near me"
              >
                {nearbyLoading ? "⏳ Searching…" : "📍 Find Places Near Me"}
              </button>
            </div>
          </div>

          {/* Category filter strip */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "14px" }}>
            {NEARBY_CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => {
                  setNearbyCategory(cat.key);
                  findNearbyPlaces(cat.key);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "6px 12px", borderRadius: "20px", fontSize: "12px",
                  fontWeight: nearbyCategory === cat.key ? 700 : 500,
                  fontFamily: "Inter,Arial,sans-serif", cursor: "pointer",
                  border: `1.5px solid ${nearbyCategory === cat.key ? "#a78bfa" : C.inBd}`,
                  background: nearbyCategory === cat.key ? "rgba(167,139,250,0.15)" : C.input,
                  color: nearbyCategory === cat.key ? "#a78bfa" : C.sub,
                  transition: "all 0.15s",
                }}
                aria-label={`Filter by ${cat.label}`}
                aria-pressed={nearbyCategory === cat.key}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Error state */}
          {nearbyError && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#f87171", fontSize: "13px", marginBottom: "12px" }}>
              <span>{nearbyError}</span>
              <button
                onClick={() => { setNearbyError(""); findNearbyPlaces(nearbyCategory); }}
                disabled={nearbyLoading}
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "inherit" }}
                aria-label="Try finding nearby places again"
              >
                🔄 Try Again
              </button>
            </div>
          )}

          {/* Loading state */}
          {nearbyLoading && (
            <div style={{ color: C.sub, fontSize: "13px", padding: "10px 0" }}>
              📡 Finding places near you…
            </div>
          )}

          {/* Empty state (only after a search has actually completed) */}
          {!nearbyLoading && !nearbyError && nearbyPlaces.length === 0 && nearbySearched && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ color: C.sub, fontSize: "13px" }}>No nearby places found.</span>
              <button
                onClick={() => findNearbyPlaces(nearbyCategory)}
                style={{ background: C.input, border: `1px solid ${C.inBd}`, color: C.sub, padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "inherit" }}
                aria-label="Try finding nearby places again"
              >
                🔄 Try Again
              </button>
            </div>
          )}

          {/* Initial prompt — no search yet */}
          {!nearbyLoading && !nearbyError && nearbyPlaces.length === 0 && !nearbySearched && (
            <div style={{ color: C.sub, fontSize: "13px" }}>
              Press <strong>Find Places Near Me</strong> to discover hospitals, pharmacies, ATMs and more sorted by distance from your location.
            </div>
          )}

          {/* Results */}
          {(() => {
            const filtered = nearbyCategory === "all"
              ? nearbyPlaces
              : nearbyPlaces.filter(p => p.amenity === nearbyCategory);
            const shown = nearbyExpanded ? filtered : filtered.slice(0, 5);
            if (!shown.length) return null;
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "10px" }}>
                  {shown.map((p, idx) => {
                    const icon      = AMENITY_ICON[p.amenity] || "📍";
                    const label     = p.label || letterLabel(idx);
                    const distM     = p.distM ?? (currentPos ? haversineM(currentPos.lat, currentPos.lon, p.lat, p.lon) : null);
                    const distLabel = distM == null ? null
                      : distM < 1000 ? `${Math.round(distM)} m`
                      : `${(distM / 1000).toFixed(1)} km`;
                    return (
                      <div
                        key={p.id || idx}
                        style={{
                          background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)",
                          border: `1px solid ${C.border}`,
                          borderRadius: "12px",
                          padding: "12px 14px",
                          cursor: "pointer",
                        }}
                        onClick={() => speak(
                          `${label}. ${p.name}. ${(p.amenity || "").replace(/_/g, " ")}.` +
                          ` Address: ${p.address ? p.address : "Address information is unavailable."}` +
                          `${distLabel ? " Distance: " + distLabel + " away." : ""}`
                        )}
                        title={`Hear about ${p.name}`}
                        role="button"
                        aria-label={`${label}, ${p.name}, ${(p.amenity || "").replace(/_/g, " ")}${distLabel ? ", " + distLabel + " away" : ""}`}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "5px" }}>
                          <span style={{
                            fontSize: "12px", fontWeight: 800, color: "#a78bfa",
                            background: "rgba(167,139,250,0.15)", borderRadius: "6px",
                            width: "20px", height: "20px", display: "flex",
                            alignItems: "center", justifyContent: "center", flexShrink: 0,
                          }}>
                            {label}
                          </span>
                          <span style={{ fontSize: "22px" }}>{icon}</span>
                          <span style={{ fontWeight: 700, color: C.text, fontSize: "13px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {p.name}
                          </span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                          <span style={{ fontSize: "11px", color: C.sub, textTransform: "capitalize" }}>
                            {(p.amenity || "").replace(/_/g, " ")}
                          </span>
                          {distLabel && (
                            <span style={{
                              fontSize: "12px", fontWeight: 700,
                              color: distM < 500 ? "#22c55e" : distM < 2000 ? "#a78bfa" : C.sub,
                            }}>
                              {distLabel}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            // Route directly to this place's known coordinates rather
                            // than re-searching its name (which could match a
                            // different, same-named place elsewhere).
                            startRouteToCoords(p.lat, p.lon, p.name);
                          }}
                          style={{
                            width: "100%", background: "rgba(167,139,250,0.1)",
                            border: "1px solid rgba(167,139,250,0.25)", color: "#a78bfa",
                            padding: "7px 0", borderRadius: "8px", cursor: "pointer",
                            fontSize: "13px", fontWeight: 700, fontFamily: "inherit",
                          }}
                          aria-label={`Navigate to ${p.name}`}
                        >
                          🗺️ Navigate
                        </button>
                      </div>
                    );
                  })}
                </div>
                {filtered.length > 5 && (
                  <button
                    onClick={() => setNearbyExpanded(v => !v)}
                    style={{ marginTop: "12px", background: "transparent", border: `1px solid ${C.inBd}`, color: C.sub, padding: "8px 18px", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "inherit" }}
                    aria-label={nearbyExpanded ? "Show fewer nearby places" : `Show all ${filtered.length} nearby places`}
                  >
                    {nearbyExpanded ? "▲ Show fewer" : `▼ Show all ${filtered.length}`}
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {/* ── Live Navigation Panel ── */}
        {(navActive || navStatus === "arrived" || navStatus === "off_route") && route && (
          <div style={{
            ...s.navPanel,
            background: isDark ? "#0d1117" : "#f0fdf4",
            border: `2px solid ${nsConfig.color}`,
            marginBottom: "20px",
          }}>
            {/* Status bar */}
            <div style={{
              background: nsConfig.bg,
              border: `1px solid ${nsConfig.color}30`,
              borderRadius: "10px",
              padding: "8px 14px",
              marginBottom: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "8px",
            }}>
              <span style={{ fontWeight: 700, color: nsConfig.color, fontSize: "14px" }}>
                {nsConfig.label}
              </span>
              {livePos && (
                <span style={{ fontSize: "11px", color: C.sub }}>
                  📡 {livePos.isManual ? "📍 Manual Origin" : `GPS ${livePos.accuracy ? `±${livePos.accuracy}m (${livePos.accuracyTier || "normal"})` : "active"}`}
                </span>
              )}
            </div>

            {navStatus !== "arrived" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                {/* Current instruction */}
                <div style={{
                  background: isDark ? "rgba(167,139,250,0.08)" : "rgba(167,139,250,0.06)",
                  border: "1px solid rgba(167,139,250,0.2)",
                  borderRadius: "12px",
                  padding: "14px",
                }}>
                  <div style={{ fontSize: "10px", color: C.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                    CURRENT
                  </div>
                  {currentStep ? (
                    <>
                      <div style={{ fontSize: "26px", marginBottom: "6px" }}>{currentStep.icon}</div>
                      <div style={{ fontWeight: 700, color: C.text, fontSize: "15px", lineHeight: 1.3 }}>
                        {currentStep.instruction}
                        {currentStep.name && (
                          <span style={{ color: "#a78bfa" }}> on {currentStep.name}</span>
                        )}
                      </div>
                      {distToNext !== null && currentStep.type !== "arrive" && (
                        <div style={{ fontSize: "13px", color: "#22c55e", fontWeight: 700, marginTop: "6px" }}>
                          {distToNext < 1000 ? `${distToNext} m` : `${(distToNext/1000).toFixed(1)} km`} to turn
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: C.sub, fontSize: "13px" }}>—</div>
                  )}
                </div>

                {/* Next instruction */}
                <div style={{
                  background: isDark ? "rgba(96,165,250,0.06)" : "rgba(96,165,250,0.04)",
                  border: "1px solid rgba(96,165,250,0.15)",
                  borderRadius: "12px",
                  padding: "14px",
                }}>
                  <div style={{ fontSize: "10px", color: C.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
                    NEXT
                  </div>
                  {nextStep ? (
                    <>
                      <div style={{ fontSize: "26px", marginBottom: "6px" }}>{nextStep.icon}</div>
                      <div style={{ fontWeight: 600, color: C.sub, fontSize: "14px", lineHeight: 1.3 }}>
                        {nextStep.instruction}
                        {nextStep.name && (
                          <span style={{ color: "#60a5fa" }}> on {nextStep.name}</span>
                        )}
                      </div>
                      {nextStep.type !== "arrive" && nextStep.distance > 0 && (
                        <div style={{ fontSize: "12px", color: C.sub, marginTop: "6px" }}>
                          in ~{fmtDist(nextStep.distance)}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: C.sub, fontSize: "13px" }}>—</div>
                  )}
                </div>
              </div>
            )}

            {navStatus === "arrived" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: "48px", marginBottom: "10px" }}>🏁</div>
                <div style={{ fontWeight: 800, color: "#22c55e", fontSize: "20px" }}>
                  You have arrived!
                </div>
                <div style={{ color: C.sub, fontSize: "14px", marginTop: "6px" }}>
                  {destRef.current.label}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Google Maps Embed ── */}
        {destination.trim() && (
          <div style={{ marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: C.sub, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                🗺️ Google Maps
              </span>
              <button
                onClick={() => openInMaps(destination)}
                style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa", padding: "7px 14px", borderRadius: "8px", fontWeight: 600, fontSize: "12px", cursor: "pointer", fontFamily: "inherit" }}
              >
                ↗ Open Full Map
              </button>
            </div>
            <iframe
              // transportMode is deliberately NOT part of this key: switching
              // Car/Bike/Walk only needs the embed to navigate to a new `src`
              // (a plain URL update on the existing element, exactly like
              // clicking a link) — it doesn't need a fresh destination or GPS
              // fix. Keying on transportMode too forced React to destroy and
              // recreate the whole iframe (a new cross-origin browsing
              // context) on every mode switch, which could leave the route
              // summary card right below it uncommitted-looking on screen
              // until something (e.g. touching the map) forced a repaint.
              key={destination + (currentPos ? currentPos.lat : "")}
              title="Google Maps Route"
              src={
                currentPos
                  ? (() => {
                      const dirflg = MODES.find(m => m.key === transportMode)?.gmapsDirflg;
                      // Bus/Train: no reliable transit dirflg for this embed — show a
                      // destination marker only rather than a misleading car route.
                      return dirflg
                        ? `https://maps.google.com/maps?saddr=${currentPos.lat},${currentPos.lon}&daddr=${encodeURIComponent(destination)}&dirflg=${dirflg}&output=embed`
                        : `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&output=embed`;
                    })()
                  : `https://maps.google.com/maps?q=${encodeURIComponent(destination)}&output=embed`
              }
              width="100%"
              height="420"
              style={{ border: "none", borderRadius: "16px", display: "block" }}
              loading="lazy"
              allowFullScreen
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        )}

        {/* ── Route result ── */}
        {route && (
          <div style={{ ...s.routeCard, background: C.card, border: `1px solid ${C.border}` }}>
            {/* Summary */}
            <div style={s.routeSummary}>
              <div style={s.summaryItem}>
                <span style={s.summaryIcon}>📍</span>
                <div>
                  <div style={{ fontSize: "11px", color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em" }}>From</div>
                  <div style={{ fontSize: "13px", color: C.text, fontWeight: 600 }}>{route.fromLabel}</div>
                </div>
              </div>
              <div style={{ color: "#a78bfa", fontSize: "20px", fontWeight: 900 }}>→</div>
              <div style={s.summaryItem}>
                <span style={s.summaryIcon}>🏁</span>
                <div>
                  <div style={{ fontSize: "11px", color: C.sub, textTransform: "uppercase", letterSpacing: "0.05em" }}>To</div>
                  <div style={{ fontSize: "13px", color: C.text, fontWeight: 600 }}>{route.destLabel}</div>
                </div>
              </div>
            </div>

            <div style={s.statsRow}>
              <div style={s.stat}>
                <div style={s.statVal}>{(route.distance / 1000).toFixed(1)} km</div>
                <div style={s.statLabel}>Distance</div>
              </div>
              <div style={s.stat}>
                <div style={s.statVal}>{route.durationIsEstimate ? `~${fmtTime(route.duration)}` : fmtTime(route.duration)}</div>
                <div style={s.statLabel}>{route.durationIsEstimate ? "Duration (est.)" : "Duration"}</div>
              </div>
              <div style={s.stat}>
                <div style={s.statVal}>{route.durationIsEstimate ? `~${fmtETA(route.duration)}` : fmtETA(route.duration)}</div>
                <div style={s.statLabel}>ETA</div>
              </div>
              <div style={s.stat}>
                <div style={s.statVal}>{MODES.find(m => m.key === transportMode)?.icon} {route.mode}</div>
                <div style={s.statLabel}>Mode</div>
              </div>
            </div>

            {route.noLiveTraffic && (
              <div style={{ fontSize: "11px", color: C.sub, marginTop: "8px" }}>
                ⓘ Routed distance/duration — no live traffic data, so actual time may be longer.
              </div>
            )}

            {/* Turn-by-turn */}
            <div style={{ marginTop: "20px" }}>
              <div style={{ fontSize: "13px", color: C.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
                Turn-by-Turn Directions ({route.steps.length} steps)
              </div>
              <div style={s.stepsList}>
                {route.steps.map((step, i) => {
                  const isActive    = navActive && i === currentStepIdx;
                  const isCompleted = stepStates[i] === "completed";
                  return (
                    <div
                      key={i}
                      style={{
                        ...s.step,
                        background: isActive
                          ? "rgba(167,139,250,0.15)"
                          : isCompleted
                          ? "rgba(34,197,94,0.06)"
                          : step.type === "arrive"
                          ? "rgba(34,197,94,0.08)"
                          : "rgba(167,139,250,0.05)",
                        border: `1px solid ${
                          isActive    ? "rgba(167,139,250,0.4)"
                          : isCompleted ? "rgba(34,197,94,0.2)"
                          : step.type === "arrive" ? "rgba(34,197,94,0.2)"
                          : "rgba(167,139,250,0.1)"
                        }`,
                        opacity: isCompleted ? 0.55 : 1,
                      }}
                      onClick={() => speak(
                        `Step ${i + 1}. ${step.instruction}${step.name ? " on " + step.name : ""}. ${fmtDist(step.distance)}.`
                      )}
                      title="Click to hear this step"
                    >
                      <div style={s.stepIcon}>{step.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: C.text, fontSize: "14px" }}>
                          {step.instruction}
                          {step.name && (
                            <span style={{ color: "#a78bfa" }}> on {step.name}</span>
                          )}
                        </div>
                        {step.type !== "arrive" && (
                          <div style={{ fontSize: "12px", color: C.sub, marginTop: "2px" }}>
                            {fmtDist(step.distance)} · {fmtTime(step.duration)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                        <div style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 700 }}>{i + 1}</div>
                        {isCompleted && <div style={{ fontSize: "10px", color: "#22c55e" }}>✓</div>}
                        {isActive    && <div style={{ fontSize: "10px", color: "#a78bfa" }}>▶</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button
              onClick={() => openInMaps(destination)}
              style={{ ...s.mapsBtn, width: "100%", marginTop: "14px", justifyContent: "center" }}
            >
              📍 Open Full Route in Google Maps
            </button>
          </div>
        )}

        {/* ── Quick navigate ── */}
        <div className="card" style={{ marginBottom: "20px" }}>
          <h3 style={{ ...s.sec, color: C.text }}>Quick Navigate To</h3>
          <div style={s.quickGrid}>
            {[
              { label: "🏥 Hospital",        q: "hospital near me"        },
              { label: "💊 Pharmacy",        q: "pharmacy near me"        },
              { label: "🏧 ATM",             q: "ATM near me"             },
              { label: "👮 Police Station",  q: "police station near me"  },
              { label: "🚌 Bus Stop",        q: "bus stop near me"        },
              { label: "🚉 Railway Station", q: "railway station near me" },
              { label: "🛒 Supermarket",     q: "supermarket near me"     },
              { label: "🏦 Bank",            q: "bank near me"            },
              { label: "⛽ Petrol Station",  q: "petrol station near me"  },
              { label: "✈️ Airport",         q: "airport near me"         },
              { label: "🍽️ Restaurant",      q: "restaurant near me"      },
              { label: "🏫 School",          q: "school near me"          },
            ].map(p => (
              <button
                key={p.q}
                onClick={() => { setDestination(p.q); setTimeout(() => startRoute(p.q), 200); }}
                style={{ ...s.quickBtn, background: C.input, border: `1.5px solid ${C.inBd}`, color: C.text }}
                aria-label={`Navigate to ${p.label}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Saved locations ── */}
        {savedLocations.length > 0 && (
          <div className="card" style={{ marginBottom: "20px" }}>
            <h3 style={{ ...s.sec, color: C.text }}>Saved Locations</h3>
            <div style={s.quickGrid}>
              {savedLocations.map(loc => (
                <button
                  key={loc.id}
                  onClick={() => { setDestination(loc.place_name); setTimeout(() => startRoute(loc.place_name), 200); }}
                  style={{ ...s.quickBtn, background: "rgba(34,197,94,0.06)", border: "1.5px solid rgba(34,197,94,0.2)", color: C.text }}
                  aria-label={`Navigate to saved location ${loc.place_name}`}
                >
                  📍 {loc.place_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Navigation history ── */}
        {requests.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h3 style={{ ...s.sec, color: C.text, marginBottom: 0 }}>Recent Destinations</h3>
              <span className="pill pill-purple">{requests.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {requests.slice(0, 6).map(req => (
                <div key={req.id} style={{ ...s.histCard, background: C.card, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "20px" }}>📍</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: "14px" }}>{req.destination}</div>
                  </div>
                  <button
                    onClick={() => { setDestination(req.destination); setTimeout(() => startRoute(req.destination), 200); }}
                    style={s.histNav}
                    aria-label={`Navigate to ${req.destination}`}
                  >
                    🗺️ Route
                  </button>
                  <button onClick={() => deleteRequest(req.id)} style={s.histDel} aria-label="Delete">🗑️</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media(max-width:600px){
          .nav-modes { flex-wrap: wrap !important; }
        }
        @media(max-width:480px){
          .nearby-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </DashboardLayout>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────────────────────── */
const s = {
  sec:        { fontSize: "16px", fontWeight: 700, marginBottom: "14px" },
  inputRow:   { display: "flex", gap: "10px", alignItems: "center" },
  input:      { padding: "13px 16px", borderRadius: "12px", fontSize: "15px", fontFamily: "Inter,Arial,sans-serif", outline: "none" },
  voiceBtn:   { background: "rgba(250,204,21,0.1)", border: "2px solid #facc15", color: "#facc15", borderRadius: "12px", width: "48px", height: "48px", fontSize: "20px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "inherit", transition: "all 0.15s" },
  voiceBtnActive: { background: "rgba(239,68,68,0.15)", borderColor: "#ef4444", color: "#ef4444" },
  modeRow:    { display: "flex", gap: "8px", flexWrap: "wrap" },
  modeBtn:    { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", padding: "10px 14px", borderRadius: "12px", border: "1.5px solid", cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s", minWidth: "60px" },
  modeBtnActive: { fontWeight: 700 },
  routeBtn:   { background: "#a78bfa", color: "#000", border: "none", padding: "13px 24px", borderRadius: "12px", fontWeight: 700, fontSize: "15px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  startNavBtn:{ background: "#22c55e", color: "#000", border: "none", padding: "13px 22px", borderRadius: "12px", fontWeight: 700, fontSize: "15px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  stopNavBtn: { background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "2px solid #ef4444", padding: "13px 20px", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  mapsBtn:    { background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa", padding: "13px 20px", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif", display: "flex", alignItems: "center", gap: "6px" },
  speakBtn:   { background: "rgba(250,204,21,0.1)", border: "1px solid rgba(250,204,21,0.3)", color: "#facc15", padding: "13px 20px", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  clearBtn:   { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "13px 16px", borderRadius: "12px", fontWeight: 600, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  navPanel:   { borderRadius: "16px", padding: "18px" },
  routeCard:  { borderRadius: "16px", padding: "20px", marginBottom: "20px" },
  routeSummary: { display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px", flexWrap: "wrap" },
  summaryItem:  { display: "flex", alignItems: "center", gap: "10px" },
  summaryIcon:  { fontSize: "24px" },
  statsRow:   { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" },
  stat:       { textAlign: "center", padding: "12px 8px", background: "rgba(167,139,250,0.06)", borderRadius: "10px", border: "1px solid rgba(167,139,250,0.1)" },
  statVal:    { fontWeight: 800, fontSize: "16px", color: "#a78bfa", marginBottom: "4px" },
  statLabel:  { fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.04em" },
  stepsList:  { display: "flex", flexDirection: "column", gap: "8px" },
  step:       { display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "12px", cursor: "pointer", transition: "opacity 0.15s" },
  stepIcon:   { fontSize: "22px", width: "32px", textAlign: "center", flexShrink: 0 },
  quickGrid:  { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px" },
  quickBtn:   { padding: "14px 10px", borderRadius: "12px", cursor: "pointer", fontWeight: 600, fontSize: "13px", fontFamily: "Inter,Arial,sans-serif", textAlign: "center", transition: "all 0.15s" },
  histCard:   { display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "12px", borderLeft: "4px solid #a78bfa" },
  histNav:    { background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "inherit", flexShrink: 0 },
  histDel:    { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", padding: "8px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", flexShrink: 0 },
};
