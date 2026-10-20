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
   SAFE JSON — catches non-JSON error pages from public endpoints
───────────────────────────────────────────────────────────────────────────── */
const safeJson = async (res) => {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    await res.text();
    if (res.status === 504 || res.status === 502 || res.status === 503) {
      throw new Error("GATEWAY_TIMEOUT");
    }
    throw new Error(`Mapping server returned error HTTP ${res.status}. Please try again.`);
  }
  return res.json();
};

/* ─────────────────────────────────────────────────────────────────────────────
   DIRECTION HELPERS & ICONS
───────────────────────────────────────────────────────────────────────────── */
const DIR_ICON = {
  right: "→", sharp_right: "↱", slight_right: "↗",
  left: "←", sharp_left: "↰", slight_left: "↖",
  straight: "↑", uturn: "↩", depart: "▶", arrive: "🏁",
  roundabout: "🔄", rotary: "🔄",
};

const getIcon = (m) => {
  if (!m) return "↑";
  if (m.type === "depart") return "▶";
  if (m.type === "arrive") return "🏁";
  if (m.type === "roundabout" || m.type === "rotary") return "🔄";
  const mod = (m.modifier || "straight").replace(/ /g, "_");
  return DIR_ICON[mod] || "↑";
};

const getInstruction = (m) => {
  if (!m) return "Continue straight";
  if (m.type === "depart") return "Head out";
  if (m.type === "arrive") return "Arrive at destination";
  if (m.type === "roundabout" || m.type === "rotary") {
    return m.exit ? `Take exit ${m.exit} at the roundabout` : "Enter the roundabout";
  }
  const mod = m.modifier || "";
  if (mod === "sharp right") return "Turn sharp right";
  if (mod === "right") return "Turn right";
  if (mod === "slight right") return "Bear right";
  if (mod === "sharp left") return "Turn sharp left";
  if (mod === "left") return "Turn left";
  if (mod === "slight left") return "Bear left";
  if (mod === "uturn") return "Make a U-turn";
  if (mod === "straight") return "Continue straight";
  return "Continue straight";
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
  if (m > 0) return `${m} min`;
  return `${sec} sec`;
};

const fmtETA = (seconds) => {
  const eta = new Date(Date.now() + seconds * 1000);
  return eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/* Proximity thresholds adapted per transport mode */
const getThresholds = (modeKey) => {
  if (modeKey === "foot") {
    return {
      announceDist: 50,  // Announce upcoming turn ~35s before at 1.4m/s
      finalDist: 15,     // "Turn now" at 15m
      completeDist: 20,  // Step passed within 20m
      arrivalDist: 25,   // Arrived within 25m
      offRouteDist: 40,  // Off route beyond 40m
    };
  }
  if (modeKey === "cycling") {
    return {
      announceDist: 100,
      finalDist: 20,
      completeDist: 30,
      arrivalDist: 25,
      offRouteDist: 60,
    };
  }
  return {
    announceDist: 150,
    finalDist: 25,
    completeDist: 40,
    arrivalDist: 30,
    offRouteDist: 80,
  };
};

const LOCATION_WATCHDOG_MS = 15000;
const NEAR_ME_RE = /\b(near me|nearby|nearest|close by|around me)\b/i;

const amenityFromQuery = (q) => {
  const t = q.toLowerCase();
  if (/hospital|clinic|doctor|medical/.test(t)) return "hospital";
  if (/pharmacy|medicine|chemist|drug/.test(t)) return "pharmacy";
  if (/\batm\b|cash machine|withdraw/.test(t)) return "atm";
  if (/police|cop/.test(t)) return "police";
  if (/railway|train station|rail station|metro station/.test(t)) return "train_station";
  if (/bus stop|bus stand|bus station/.test(t)) return "bus_stop";
  if (/airport|aerodrome/.test(t)) return "aerodrome";
  if (/hotel|lodge|motel|accommodation/.test(t)) return "hotel";
  if (/restaurant|food|cafe|coffee|fast food/.test(t)) return "restaurant";
  if (/\bbank\b/.test(t)) return "bank";
  if (/petrol|fuel|gas station|filling station/.test(t)) return "fuel";
  if (/supermarket|grocery|mall/.test(t)) return "supermarket";
  if (/college|university/.test(t)) return "college";
  if (/school/.test(t)) return "school";
  return null;
};

const AMENITY_ICON = {
  hospital: "🏥",
  pharmacy: "💊",
  atm: "🏧",
  police: "👮",
  restaurant: "🍽️",
  cafe: "☕",
  hotel: "🏨",
  bank: "🏦",
  supermarket: "🛒",
  bus_station: "🚌",
  clinic: "🏥",
  school: "🏫",
  train_station: "🚉",
  bus_stop: "🚌",
  fuel: "⛽",
  aerodrome: "✈️",
  college: "🎓",
};

const NEARBY_CATEGORIES = [
  { key: "all",           label: "All Places",       icon: "📍" },
  { key: "hospital",      label: "Hospitals",        icon: "🏥" },
  { key: "pharmacy",      label: "Pharmacies",       icon: "💊" },
  { key: "atm",           label: "ATMs",             icon: "🏧" },
  { key: "police",        label: "Police Stations",  icon: "👮" },
  { key: "bus_stop",      label: "Bus Stops",        icon: "🚌" },
  { key: "train_station", label: "Railway Stations", icon: "🚉" },
  { key: "bank",          label: "Banks",            icon: "🏦" },
  { key: "restaurant",    label: "Restaurants",      icon: "🍽️" },
  { key: "supermarket",   label: "Supermarkets",     icon: "🛒" },
  { key: "fuel",          label: "Petrol Stations",  icon: "⛽" },
  { key: "school",        label: "Schools",          icon: "🏫" },
];

/* Wall-clock deadline helper */
const withTimeout = (promise, ms, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });

/* ─────────────────────────────────────────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────────────────────────────────────────── */
export default function NavigationPage() {
  const { settings, speak } = useAccessibility();
  const [searchParams] = useSearchParams();
  const isDark = settings.theme === "dark";

  /* ── Core Navigation State ── */
  const [destination, setDestination] = useState("");
  const [startLocation, setStartLocation] = useState("");
  const [currentPos, setCurrentPos] = useState(null);
  const [transportMode, setTransportMode] = useState("foot"); // Defaults to Walk for visually impaired users
  const [routeStatus, setRouteStatus] = useState("idle");
  const [route, setRoute] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [savedLocations, setSavedLocations] = useState([]);
  const [voiceListening, setVoiceListening] = useState(false);
  const [requests, setRequests] = useState([]);

  /* ── Nearby Suggesting Places State ── */
  const [nearbyPlaces, setNearbyPlaces] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyCategory, setNearbyCategory] = useState("all");
  const [nearbyExpanded, setNearbyExpanded] = useState(false); // Controls Show all vs top 5
  const [nearbyError, setNearbyError] = useState("");
  const [nearbySearched, setNearbySearched] = useState(false);
  const nearbyStopRef = useRef(false);

  /* ── Live GPS Navigation State ── */
  const [navActive, setNavActive] = useState(false);
  const [navStatus, setNavStatus] = useState("idle");
  const [livePos, setLivePos] = useState(null);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [stepStates, setStepStates] = useState([]); // "pending"|"announced"|"final"|"completed"
  const [distToNext, setDistToNext] = useState(null);

  /* ── Refs ── */
  const routeRef = useRef(null);
  const stepStatesRef = useRef([]);
  const currentStepIdxRef = useRef(0);
  const navActiveRef = useRef(false);
  const stopRef = useRef(false);
  const watchIdRef = useRef(null);
  const recRef = useRef(null);
  const rerouting = useRef(false);
  const destRef = useRef({ lat: null, lon: null, label: "" });
  const routeReqRef = useRef(0);
  const transportModeRef = useRef("foot");

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

  /* Voice-friendly category label */
  const categoryWordFor = (amenity) =>
    (NEARBY_CATEGORIES.find((c) => c.key === amenity)?.label || (amenity || "place").replace(/_/g, " ")).toLowerCase();

  /* ── Initial Data & URL parameter auto-routing ── */
  useEffect(() => {
    API.get("/locations").then((r) => setSavedLocations(r.data)).catch(() => {});
    API.get("/navigation").then((r) => setRequests(r.data)).catch(() => {});

    // Automatically acquire initial GPS location and fetch nearby options on load
    getCurrentLocation()
      .then((pos) => {
        setCurrentPos(pos);
        fetchNearbyPlaces(pos.lat, pos.lon, "all");
      })
      .catch(() => {});

    const d = searchParams.get("dest");
    if (d) {
      setDestination(d);
      setTimeout(() => startRoute(d), 500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Cleanup watch on unmount ── */
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      try { recRef.current?.stop(); } catch {}
    };
  }, []);

  /* ─────────────────────────────────────────────────────────────────────────
     GPS ACQUISITION
  ───────────────────────────────────────────────────────────────────────── */
  const getCurrentLocation = () =>
    new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported on this device or browser."));
        return;
      }

      let settled = false;
      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Could not acquire GPS location in time. Please check device location settings."));
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
            settleReject(new Error("Invalid GPS coordinates received from device."));
            return;
          }
          const accInfo = classifyAccuracy(accuracy);
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
            const label = data?.display_name?.split(",").slice(0, 2).join(", ") || "Current Location";
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
              ts: Date.now(),
            });
          } catch {
            settleResolve({
              lat,
              lon,
              accuracy: accInfo.accuracy,
              accuracyTier: accInfo.tier,
              accuracyLabel: accInfo.label,
              accuracyAdvisory: accInfo.advisory,
              label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
              countryCode: "",
              ts: Date.now(),
            });
          }
        },
        (err) => {
          let msg = "Location unavailable. Please check location permissions or enter a start address.";
          if (err.code === 1) msg = "Location access was denied. Please allow location permissions in your browser.";
          else if (err.code === 2) msg = "GPS location is currently unavailable. Try entering a starting address.";
          else if (err.code === 3) msg = "GPS search timed out. Check connection or enter a start address.";
          settleReject(new Error(msg));
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 }
      );
    });

  /* ─────────────────────────────────────────────────────────────────────────
     GEOCODING (OpenStreetMap Nominatim with localized viewbox bias)
  ───────────────────────────────────────────────────────────────────────── */
  const geocode = async (query, nearLat, nearLon, countryCode = "") => {
    const cc = countryCode ? `&countrycodes=${countryCode}` : "";
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
        if (err.name === "AbortError") throw new Error("Location search timed out. Please try again.");
        throw err;
      } finally {
        clearTimeout(timer);
      }
    };

    const tryRun = async (extra) => {
      try { return await run(extra); } catch { return []; }
    };

    let data = await tryRun(box);
    if (!data.length && nearLat) data = await tryRun();
    if (!data.length && countryCode) data = await tryRun("");
    if (!data.length) throw new Error(`Location not found: "${query}". Try adding your city or area name.`);

    let best = data[0];
    if (nearLat && nearLon && data.length > 1) {
      best = data.reduce((prev, cur) =>
        haversineKm(nearLat, nearLon, parseFloat(cur.lat), parseFloat(cur.lon)) <
        haversineKm(nearLat, nearLon, parseFloat(prev.lat), parseFloat(prev.lon))
          ? cur : prev
      );
    }

    return {
      lat: parseFloat(best.lat),
      lon: parseFloat(best.lon),
      label: best.display_name?.split(",").slice(0, 3).join(", "),
    };
  };

  /* ─────────────────────────────────────────────────────────────────────────
     NEARBY PLACES DISCOVERY (Zero API keys, sorted nearest first)
  ───────────────────────────────────────────────────────────────────────── */
  const fetchNearbyPlaces = async (userLat, userLon, cat = "all") => {
    setNearbyLoading(true);
    setNearbyError("");
    setNearbyPlaces([]);
    try {
      const places = await searchNearbyPlaces(cat, userLat, userLon, { radiusKm: 10 });
      if (nearbyStopRef.current) return [];
      if (!places || places.length === 0) {
        const catWord = cat === "all" ? "places" : `${categoryWordFor(cat)}`;
        const msg = `No ${catWord} found near your location.`;
        setNearbyPlaces([]);
        setNearbyError(msg);
        return [];
      }
      if (!nearbyStopRef.current) setNearbyPlaces(places);
      return places;
    } catch (err) {
      if (!nearbyStopRef.current) {
        const msg = err.message || "Could not find nearby places. Please try again.";
        setNearbyError(msg);
      }
      return [];
    } finally {
      setNearbyLoading(false);
      if (!nearbyStopRef.current) setNearbySearched(true);
    }
  };

  const findNearbyPlaces = async (cat = nearbyCategory) => {
    if (nearbyLoading) return;

    nearbyStopRef.current = false;
    setNearbyError("");
    setNearbyLoading(true);
    setNearbyPlaces([]);
    setNearbyExpanded(false);

    let pos = currentPos;
    const posIsFresh = pos?.ts && (Date.now() - pos.ts) < 30000;

    try {
      if (!posIsFresh) {
        pos = await getCurrentLocation();
        if (nearbyStopRef.current) { setNearbyLoading(false); return; }
        setCurrentPos(pos);
      }
      const catWord = cat === "all" ? "places" : `${categoryWordFor(cat)}`;
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
      setNearbyPlaces(places);
      setNearbyCategory(cat);
      speak(`Found ${places.length} nearby ${catWord}. Select any place to navigate.`);
    } catch (err) {
      let msg = err.message || "Could not find nearby places. Please try again.";
      if (/denied|allow location|need your location/i.test(msg)) {
        msg = "Location permission is required to find nearby places. Please allow location access in your browser.";
      }
      setNearbyError(msg);
      speak(msg);
    } finally {
      setNearbyLoading(false);
      if (!nearbyStopRef.current) setNearbySearched(true);
    }
  };

  /* Audio reading of nearby places without asking for Option A or B */
  const readNearbyPlacesAloud = () => {
    const filtered = nearbyCategory === "all"
      ? nearbyPlaces
      : nearbyPlaces.filter((p) => p.amenity === nearbyCategory);
    if (!filtered.length) {
      speak("No nearby places to read.");
      return;
    }
    const top = filtered.slice(0, 5);
    const catLabel = nearbyCategory === "all" ? "places" : `${categoryWordFor(nearbyCategory)}`;
    let text = `Found ${filtered.length} nearby ${catLabel}. `;
    top.forEach((p, i) => {
      const distText = p.formattedDist || (p.distM != null ? `${fmtDist(p.distM)} away` : "");
      text += `${i + 1}: ${p.name}, ${distText}. `;
    });
    text += `Tap any card or click navigate to start routing.`;
    speak(text);
  };

  /* ─────────────────────────────────────────────────────────────────────────
     OSRM & OPENSTREETMAP ROUTE FETCH — strictly zero API keys.
     Supports Walk (routed-foot), Bike (routed-bike), and Car (OSRM driving).
  ───────────────────────────────────────────────────────────────────────── */
  const fetchOsrmRoute = async (fromLat, fromLon, toLat, toLon, modeKeyOrProfile = "foot") => {
    const mode = MODES.find((m) =>
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

  const buildSteps = (osrmRoute) =>
    osrmRoute.legs[0].steps.map((s) => ({
      instruction: getInstruction(s.maneuver),
      icon: getIcon(s.maneuver),
      name: s.name,
      distance: s.distance,
      duration: s.duration,
      type: s.maneuver?.type,
      wpLat: s.maneuver?.location?.[1] ?? null,
      wpLon: s.maneuver?.location?.[0] ?? null,
    }));

  const speakNav = useCallback((text) => {
    speak(text);
  }, [speak]);

  /* ─────────────────────────────────────────────────────────────────────────
     NAVIGATION CONTROLS: STOP, CLEAR, REPEAT
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

  const clearNavigation = useCallback(() => {
    stopNavigation();
    stopRef.current = true;
    nearbyStopRef.current = true;
    setRouteStatus("idle");
    setRoute(null);
    routeRef.current = null;
    setDestination("");
    setStartLocation("");
    setErrorMsg("");
    setNavStatus("idle");
    speak("Navigation cleared.");
  }, [stopNavigation, speak]);

  /* Dedicated Repeat Step button for blind users */
  const repeatCurrentStep = useCallback(() => {
    if (!routeRef.current?.steps?.length) {
      if (destination.trim()) {
        speak(`Destination is set to ${destination}. Press Get Route to start.`);
      } else {
        speak("No active navigation route. Please set or speak a destination.");
      }
      return;
    }

    const steps = routeRef.current.steps;
    const idx = currentStepIdxRef.current;
    const step = steps[idx];
    if (!step) return;

    if (step.type === "arrive" || navStatus === "arrived") {
      speak(`You have arrived at your destination: ${destRef.current.label || destination}.`);
      return;
    }

    const road = step.name ? ` onto ${step.name}` : "";
    const distPhrase = distToNext !== null && distToNext > 5
      ? `In ${fmtDist(distToNext)}, `
      : "";
    speak(`Step ${idx + 1}: ${distPhrase}${step.instruction}${road}.`);
  }, [destination, distToNext, navStatus, speak]);

  /* ─────────────────────────────────────────────────────────────────────────
     LIVE GPS TRACKING & TURN-BY-TURN GUIDANCE
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

    const steps = routeRef.current?.steps;
    const dest = destRef.current;
    if (!steps?.length) return;

    const idx = currentStepIdxRef.current;
    const step = steps[idx];
    if (!step) return;

    const modeKey = transportModeRef.current;
    const thresholds = getThresholds(modeKey);

    /* 1. Check Arrival */
    const arrivalDist = haversineM(lat, lon, dest.lat, dest.lon);
    if (checkArrivalEligibility(idx, steps.length, arrivalDist, thresholds.arrivalDist)) {
      navActiveRef.current = false;
      setNavActive(false);
      setNavStatus("arrived");
      if (watchIdRef.current !== null) {
        navigator.geolocation?.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      speakNav(`You have arrived at your destination, ${dest.label}. Navigation complete.`);
      return;
    }

    /* 2. Distance to current step maneuver waypoint */
    const distToWp = (step.wpLat != null && step.wpLon != null)
      ? haversineM(lat, lon, step.wpLat, step.wpLon)
      : null;

    if (distToWp !== null) setDistToNext(Math.round(distToWp));

    const states = [...stepStatesRef.current];

    /* 3. Check if step is completed */
    if (distToWp !== null && distToWp < thresholds.completeDist && step.type !== "arrive") {
      states[idx] = "completed";
      const nextIdx = idx + 1;
      if (nextIdx < steps.length) {
        currentStepIdxRef.current = nextIdx;
        setCurrentStepIdx(nextIdx);
        stepStatesRef.current = states;
        setStepStates([...states]);

        const nextStep = steps[nextIdx];
        if (nextStep && nextStep.type !== "arrive") {
          const road = nextStep.name ? ` on ${nextStep.name}` : "";
          speakNav(`${nextStep.instruction}${road}.`);
        }
        setNavStatus("active");
      }
      return;
    }

    /* 4. Off-route detection with dynamic threshold to prevent sensor jitter loops */
    const dynamicThreshold = computeDynamicOffRouteThreshold(thresholds.offRouteDist, accuracy);
    if (distToWp !== null && dynamicThreshold !== Infinity && distToWp > dynamicThreshold * 2.5 && !rerouting.current) {
      const nearAnyUpcomingStep = steps.some((st, si) => {
        if (si <= idx || st.wpLat == null) return false;
        return haversineM(lat, lon, st.wpLat, st.wpLon) < dynamicThreshold * 2;
      });

      if (!nearAnyUpcomingStep && distToWp > dynamicThreshold * 3) {
        rerouting.current = true;
        setNavStatus("off_route");
        speakNav("You are off route. Recalculating route now.");

        fetchOsrmRoute(lat, lon, dest.lat, dest.lon, modeKey)
          .then((newOsrmRoute) => {
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
            if (newSteps[0]) {
              const road = newSteps[0].name ? ` on ${newSteps[0].name}` : "";
              speakNav(`Route updated. ${newSteps[0].instruction}${road}.`);
            }
          })
          .catch(() => {
            rerouting.current = false;
            setNavStatus("active");
          });
        return;
      }
    }

    /* 5. Proximity Turn Announcements */
    if (distToWp !== null && step.type !== "depart" && step.type !== "arrive") {
      const currentState = states[idx] || "pending";

      if (currentState === "pending" && distToWp <= thresholds.announceDist) {
        states[idx] = "announced";
        stepStatesRef.current = states;
        setStepStates([...states]);
        setNavStatus("approaching");
        const road = step.name ? ` onto ${step.name}` : "";
        speakNav(`In ${fmtDist(distToWp)}, ${step.instruction}${road}.`);
      } else if (currentState === "announced" && distToWp <= thresholds.finalDist) {
        states[idx] = "final";
        stepStatesRef.current = states;
        setStepStates([...states]);
        const road = step.name ? ` onto ${step.name}` : "";
        speakNav(`${step.instruction}${road} now.`);
      }
    }
  }, [speakNav]);

  const startGpsTracking = useCallback(() => {
    if (!navigator.geolocation) {
      speak("Location access is required for live GPS navigation.");
      return;
    }
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      handleGpsUpdate,
      (err) => {
        let msg = "GPS signal lost.";
        if (err.code === 1) msg = "Location permission is required for live guidance.";
        else if (err.code === 3) msg = "GPS timed out. Check signal connection.";
        setNavStatus("idle");
        speak(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 4000 }
    );
  }, [handleGpsUpdate, speak]);

  const startActiveNavigation = (routeData = route) => {
    if (!routeData?.steps?.length) {
      speak("Please calculate a route first.");
      return;
    }
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

    const first = routeData.steps[0];
    const road = first?.name ? ` on ${first.name}` : "";
    speakNav(`Live navigation started to ${routeData.destLabel}. ${first?.instruction || "Head out"}${road}.`);

    startGpsTracking();
  };

  /* ─────────────────────────────────────────────────────────────────────────
     ROUTE BUILDER — computes OSRM route, saves, and announces accessibility summary
  ───────────────────────────────────────────────────────────────────────── */
  const buildAndSpeakRoute = async (pos, destLat, destLon, destLabel, mode, reqToken) => {
    setRouteStatus("routing");
    speak(`Calculating ${mode.label} route.`);

    const osrmRoute = await fetchOsrmRoute(pos.lat, pos.lon, destLat, destLon, mode.key);
    if (stopRef.current) return;
    if (reqToken !== routeReqRef.current) return;

    const steps = buildSteps(osrmRoute);
    const { duration, isEstimate } = estimateDuration(mode.key, osrmRoute.distance, osrmRoute.duration);

    const routeData = {
      distance: osrmRoute.distance,
      duration,
      durationIsEstimate: isEstimate,
      noLiveTraffic: mode.key === "driving",
      steps,
      destLabel,
      fromLabel: pos.label,
      mode: mode.label,
      modeKey: mode.key,
      _destLat: destLat,
      _destLon: destLon,
      _fromLat: pos.lat,
      _fromLon: pos.lon,
    };

    routeRef.current = routeData;
    destRef.current = { lat: destLat, lon: destLon, label: destLabel };

    setRoute(routeData);
    setRouteStatus("done");

    // Persist to backend history
    API.post("/navigation", { destination: destLabel }).catch(() => {});
    API.get("/navigation").then((res) => setRequests(res.data)).catch(() => {});

    // Audio summary for blind user
    const distKm = (osrmRoute.distance / 1000).toFixed(1);
    const minutes = Math.max(1, Math.round(duration / 60));
    const timePhrase = isEstimate ? `approximately ${minutes} minutes` : `${minutes} minutes`;
    const eta = fmtETA(duration);
    const trafficNote = routeData.noLiveTraffic ? " Live traffic is not included." : "";
    const startNotice = pos.isManual ? "Using custom start location. " : "";

    speak(
      `${startNotice}${mode.label} route to ${destLabel}. Distance is ${distKm} kilometres. ` +
      `Estimated time is ${timePhrase}.${trafficNote} Arriving at approximately ${eta}. ` +
      `Press Start Navigation or say Start to begin GPS guidance.`
    );
  };

  /* Route directly to a selected card's coordinates */
  const startRouteToCoords = async (destLat, destLon, destLabel) => {
    stopNavigation();
    stopRef.current = false;
    nearbyStopRef.current = false;
    const reqToken = ++routeReqRef.current;
    setRoute(null);
    setErrorMsg("");
    setDestination(destLabel);

    const mode = MODES.find((m) => m.key === transportModeRef.current) || MODES[0];

    try {
      await withTimeout((async () => {
        let pos = currentPos;
        if (!pos || !pos.lat) {
          setRouteStatus("locating");
          speak("Getting your location.");
          pos = await getCurrentLocation();
          setCurrentPos(pos);
        }
        if (stopRef.current) return;
        await buildAndSpeakRoute(pos, destLat, destLon, destLabel, mode, reqToken);
      })(), 25000, "Calculating route took too long. Please check your internet connection.");
    } catch (err) {
      setRouteStatus("error");
      const msg = err.message || "Could not calculate route. Check connection.";
      setErrorMsg(msg);
      speak(msg);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     MAIN ROUTING TRIGGER
  ───────────────────────────────────────────────────────────────────────── */
  const startRoute = async (destInput = destination) => {
    const dest = (destInput || "").trim();
    if (!dest) {
      speak("Please enter or speak a destination.");
      return;
    }

    stopNavigation();
    stopRef.current = false;
    const reqToken = ++routeReqRef.current;

    setRoute(null);
    setErrorMsg("");

    const mode = MODES.find((m) => m.key === transportModeRef.current) || MODES[0];

    try {
      await withTimeout((async () => {
        // Step 1: Resolve Start Position (Manual or Live GPS)
        let pos = null;
        if (startLocation.trim()) {
          setRouteStatus("geocoding");
          speak(`Locating starting position ${startLocation}.`);
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
          speak("Getting your location.");
          pos = await getCurrentLocation();
          setCurrentPos(pos);
          if (pos.accuracyAdvisory) {
            speak(pos.accuracyAdvisory);
          }
        }
        if (stopRef.current) return;

        // Step 2: Check for "near me" or category query
        if (NEAR_ME_RE.test(dest)) {
          const tag = amenityFromQuery(dest) || "hospital";
          setRouteStatus("routing");
          speak(`Finding closest ${tag.replace(/_/g, " ")} near you.`);
          const places = await searchNearbyPlaces(tag, pos.lat, pos.lon, { radiusKm: 10 });
          if (stopRef.current) return;

          if (!places || places.length === 0) {
            throw new Error(`No ${tag.replace(/_/g, " ")} found near your location.`);
          }

          // Populate the nearby cards with all matching options
          setNearbyPlaces(places);
          setNearbyCategory(tag);
          setNearbySearched(true);

          const nearest = places[0];
          setDestination(nearest.name);
          speak(`Found nearest ${tag.replace(/_/g, " ")}: ${nearest.name}, ${nearest.formattedDist}. Calculating ${mode.label} route.`);
          await buildAndSpeakRoute(pos, nearest.lat, nearest.lon, nearest.name, mode, reqToken);
          return;
        }

        // Step 3: Resolve named destination with localized geocoding
        setRouteStatus("geocoding");
        speak(`Finding ${dest} on the map.`);
        const destCoords = await geocode(dest, pos.lat, pos.lon, pos.countryCode || "");
        if (stopRef.current) return;

        // Sanity distance check
        const sanityDist = haversineKm(pos.lat, pos.lon, destCoords.lat, destCoords.lon);
        if (sanityDist > 300) {
          throw new Error(
            `Found "${destCoords.label}" but it is ${sanityDist.toFixed(0)} km away — likely wrong. Add your city name, e.g. "${dest}, Chennai".`
          );
        }

        // Step 4: Route calculation
        await buildAndSpeakRoute(pos, destCoords.lat, destCoords.lon, destCoords.label, mode, reqToken);

        // Fetch nearby places around user in background so options remain available
        fetchNearbyPlaces(pos.lat, pos.lon, "all");
      })(), 35000, "Calculating route took too long. Please check your internet connection.");
    } catch (err) {
      setRouteStatus("error");
      const msg = /gateway.?timeout|504/i.test(err.message || "")
        ? "Mapping service is temporarily busy. Please try again."
        : (err.message || "Could not calculate route. Check your connection.");
      setErrorMsg(msg);
      speak(msg);
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     SWITCH TRANSPORT MODE (Auto-recalculates if route already active)
  ───────────────────────────────────────────────────────────────────────── */
  const changeTransportMode = async (newModeKey) => {
    if (transportMode === newModeKey) return;
    setTransportMode(newModeKey);
    transportModeRef.current = newModeKey;
    const modeObj = MODES.find((m) => m.key === newModeKey) || MODES[0];
    speak(`Transport mode set to ${modeObj.label}.`);

    if (destRef.current?.lat && destRef.current?.lon) {
      const pos = livePos || currentPos || {
        lat: routeRef.current?._fromLat,
        lon: routeRef.current?._fromLon,
        label: routeRef.current?.fromLabel || "Current Location",
        isManual: false,
      };
      const reqToken = ++routeReqRef.current;
      try {
        await buildAndSpeakRoute(pos, destRef.current.lat, destRef.current.lon, destRef.current.label, modeObj, reqToken);
      } catch (err) {
        setErrorMsg(err.message || "Could not calculate route for this mode.");
      }
    }
  };

  /* ─────────────────────────────────────────────────────────────────────────
     READ ENTIRE ROUTE SUMMARY ALOUD
  ───────────────────────────────────────────────────────────────────────── */
  const speakRoute = (r = route) => {
    if (!r) return;
    const distKm = (r.distance / 1000).toFixed(1);
    const time = fmtTime(r.duration);
    const eta = fmtETA(r.duration);
    let text = `${r.mode} route from ${r.fromLabel} to ${r.destLabel}. Total distance: ${distKm} kilometres. Travel time: ${time}. ETA: ${eta}. ${r.steps.length} steps. `;
    r.steps.forEach((s, i) => {
      if (s.type === "arrive") { text += `Finally, arrive at your destination. `; return; }
      const road = s.name ? ` onto ${s.name}` : "";
      const dist = s.distance > 5 ? ` for ${fmtDist(s.distance)}` : "";
      text += `Step ${i + 1}: ${s.instruction}${road}${dist}. `;
    });
    speak(text);
  };

  /* ─────────────────────────────────────────────────────────────────────────
     VOICE RECOGNITION & VOICE COMMAND HANDLER (Direct, NO Option A/B loop)
  ───────────────────────────────────────────────────────────────────────── */
  const handleVoiceCommand = (rawTranscript) => {
    const t = rawTranscript.trim().toLowerCase();

    // 1. Stop Navigation
    if (/^stop( navigation)?$/.test(t)) {
      stopNavigation();
      speak("Navigation stopped.");
      return;
    }

    // 2. Clear Navigation
    if (/^clear( navigation| route)?$/.test(t)) {
      clearNavigation();
      return;
    }

    // 3. Repeat Step
    if (/^(repeat|repeat step|where do i go|what is next|next step|where am i)$/.test(t)) {
      repeatCurrentStep();
      return;
    }

    // 4. Start Navigation
    if (/^(start|start navigation|begin navigation|start gps)$/.test(t)) {
      if (routeRef.current) {
        startActiveNavigation(routeRef.current);
      } else {
        speak("No route loaded yet. Please state your destination first.");
      }
      return;
    }

    // 5. Change Transport Mode
    if (/^(use |switch to |mode )?(walk|walking|pedestrian|foot)$/.test(t)) {
      changeTransportMode("foot");
      return;
    }
    if (/^(use |switch to |mode )?(bike|bicycle|cycling)$/.test(t)) {
      changeTransportMode("cycling");
      return;
    }
    if (/^(use |switch to |mode )?(car|drive|driving)$/.test(t)) {
      changeTransportMode("driving");
      return;
    }

    // 6. Navigate to nearest X
    const nearestMatch = t.match(/^(?:navigate to |take me to |go to )?(?:the )?nearest (.+)$/);
    if (nearestMatch) {
      const query = `${nearestMatch[1]} near me`;
      setDestination(query);
      startRoute(query);
      return;
    }

    // 7. General Destination
    const cleanDest = t.replace(/^(navigate to|take me to|go to|directions to|route to)\s+/i, "").trim();
    if (cleanDest) {
      setDestination(cleanDest);
      speak(`Destination received: ${cleanDest}. Finding route now.`);
      startRoute(cleanDest);
    }
  };

  const startVoiceInput = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      speak("Voice input is not supported in this browser. Please use Google Chrome.");
      return;
    }
    if (voiceListening) {
      recRef.current?.stop();
      setVoiceListening(false);
      return;
    }

    window.speechSynthesis.cancel();

    try {
      const rec = new SR();
      rec.lang = settings.language || "en-US";
      rec.continuous = false;
      rec.interimResults = false;
      recRef.current = rec;

      rec.onstart = () => {
        setVoiceListening(true);
      };

      rec.onresult = (e) => {
        const transcript = e.results[0][0].transcript.trim();
        setVoiceListening(false);
        handleVoiceCommand(transcript);
      };

      rec.onerror = (e) => {
        setVoiceListening(false);
        if (e.error !== "no-speech") {
          speak("Could not understand voice input. Please try again.");
        }
      };

      rec.onend = () => {
        setVoiceListening(false);
      };

      rec.start();
    } catch {
      setVoiceListening(false);
    }
  };

  const openInMaps = (dest = destination) => {
    if (!dest) return;
    const travelmode = MODES.find((m) => m.key === transportMode)?.travelmode || "walking";
    if (currentPos) {
      window.open(
        `https://www.google.com/maps/dir/?api=1&origin=${currentPos.lat},${currentPos.lon}&destination=${encodeURIComponent(dest)}&travelmode=${travelmode}`,
        "_blank"
      );
    } else {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`, "_blank");
    }
  };

  const deleteRequest = async (id) => {
    try {
      await API.delete(`/navigation/${id}`);
      setRequests((p) => p.filter((r) => r.id !== id));
    } catch {}
  };

  /* ─────────────────────────────────────────────────────────────────────────
     STATUS LABELS
  ───────────────────────────────────────────────────────────────────────── */
  const statusLabel = {
    idle: null,
    locating: "📡 Acquiring GPS position…",
    geocoding: "🔍 Finding location on map…",
    routing: "🗺️ Calculating turn-by-turn route…",
    done: null,
    error: null,
  }[routeStatus];

  const navStatusConfig = {
    idle:          { label: "", color: C.sub, bg: "transparent" },
    active:        { label: "🧭 Live GPS Navigation Active", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    approaching:   { label: "⚠️ Approaching Turn", color: "#f59e0b", bg: "rgba(245,158,11,0.15)" },
    arrived:       { label: "🏁 Arrived at Destination", color: "#22c55e", bg: "rgba(34,197,94,0.2)" },
    off_route:     { label: "⚠️ Off Route — Recalculating", color: "#ef4444", bg: "rgba(239,68,68,0.15)" },
    recalculating: { label: "🔄 Recalculating Route…", color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  };
  const nsConfig = navStatusConfig[navStatus] || navStatusConfig.idle;

  const currentStep = route?.steps?.[currentStepIdx] || null;
  const nextStep = route?.steps?.[currentStepIdx + 1] || null;

  /* ─────────────────────────────────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────────────────────────────────── */
  return (
    <DashboardLayout>
      <div className="fade-in">
        <div className="page-header" style={{ marginBottom: "20px" }}>
          <h1 style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>🗺️</span>
            <span>Turn-by-Turn Navigation</span>
          </h1>
          <p style={{ fontSize: "15px", color: C.sub, lineHeight: "1.5" }}>
            High-accuracy spoken guidance designed for visually impaired and blind users. Works seamlessly across Walk, Bike, and Car transport.
          </p>
        </div>

        {errorMsg && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: "16px", fontSize: "15px", fontWeight: 600 }}>
            {errorMsg}
          </div>
        )}

        {statusLabel && (
          <div className="alert alert-info" style={{ marginBottom: "16px", fontSize: "15px", fontWeight: 600 }}>
            {statusLabel}
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────────
           LIVE NAVIGATION PANEL (Prominently displayed when active)
        ─────────────────────────────────────────────────────────────────── */}
        {(navActive || navStatus === "arrived" || navStatus === "off_route") && route && (
          <div
            style={{
              ...s.navPanel,
              background: isDark ? "#0d1117" : "#f0fdf4",
              border: `2.5px solid ${nsConfig.color}`,
              marginBottom: "24px",
              boxShadow: "0 6px 24px rgba(0,0,0,0.15)",
            }}
            aria-live="assertive"
          >
            {/* Status bar & GPS Accuracy */}
            <div
              style={{
                background: nsConfig.bg,
                border: `1.5px solid ${nsConfig.color}40`,
                borderRadius: "12px",
                padding: "10px 16px",
                marginBottom: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <span style={{ fontWeight: 800, color: nsConfig.color, fontSize: "16px" }}>
                {nsConfig.label}
              </span>
              {livePos && (
                <span style={{ fontSize: "12px", color: C.text, fontWeight: 700 }}>
                  📡 {livePos.isManual ? "📍 Manual Origin" : `GPS ±${livePos.accuracy}m (${livePos.accuracyTier || "high"})`}
                </span>
              )}
            </div>

            {navStatus !== "arrived" && (
              <>
                {/* Current & Next Turn Step Card */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
                  {/* Current Turn */}
                  <div
                    style={{
                      background: isDark ? "rgba(167,139,250,0.12)" : "rgba(167,139,250,0.08)",
                      border: "2px solid rgba(167,139,250,0.35)",
                      borderRadius: "14px",
                      padding: "16px",
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#a78bfa", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                      CURRENT INSTRUCTION
                    </div>
                    {currentStep ? (
                      <>
                        <div style={{ fontSize: "36px", marginBottom: "8px" }}>{currentStep.icon}</div>
                        <div style={{ fontWeight: 800, color: C.text, fontSize: "17px", lineHeight: 1.3 }}>
                          {currentStep.instruction}
                          {currentStep.name && <span style={{ color: "#a78bfa" }}> onto {currentStep.name}</span>}
                        </div>
                        {distToNext !== null && currentStep.type !== "arrive" && (
                          <div style={{ fontSize: "16px", color: "#22c55e", fontWeight: 800, marginTop: "8px" }}>
                            {distToNext < 1000 ? `${distToNext} m` : `${(distToNext / 1000).toFixed(1)} km`} to turn
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ color: C.sub, fontSize: "14px" }}>—</div>
                    )}
                  </div>

                  {/* Next Upcoming Turn */}
                  <div
                    style={{
                      background: isDark ? "rgba(96,165,250,0.1)" : "rgba(96,165,250,0.06)",
                      border: "2px solid rgba(96,165,250,0.25)",
                      borderRadius: "14px",
                      padding: "16px",
                    }}
                  >
                    <div style={{ fontSize: "11px", color: "#60a5fa", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }}>
                      UPCOMING NEXT
                    </div>
                    {nextStep ? (
                      <>
                        <div style={{ fontSize: "36px", marginBottom: "8px" }}>{nextStep.icon}</div>
                        <div style={{ fontWeight: 700, color: C.sub, fontSize: "15px", lineHeight: 1.3 }}>
                          {nextStep.instruction}
                          {nextStep.name && <span style={{ color: "#60a5fa" }}> onto {nextStep.name}</span>}
                        </div>
                        {nextStep.type !== "arrive" && nextStep.distance > 0 && (
                          <div style={{ fontSize: "13px", color: C.sub, marginTop: "8px", fontWeight: 600 }}>
                            in ~{fmtDist(nextStep.distance)}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ color: C.sub, fontSize: "14px" }}>—</div>
                    )}
                  </div>
                </div>

                {/* Accessible Voice & Control Actions */}
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                  <button
                    onClick={repeatCurrentStep}
                    style={{
                      background: "#facc15",
                      color: "#000",
                      border: "none",
                      padding: "14px 24px",
                      borderRadius: "12px",
                      fontWeight: 800,
                      fontSize: "16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flex: 1,
                      justifyContent: "center",
                      boxShadow: "0 2px 8px rgba(250,204,21,0.25)",
                    }}
                    aria-label="Repeat current turn instruction aloud"
                  >
                    <span style={{ fontSize: "20px" }}>🔊</span>
                    <span>Repeat Step</span>
                  </button>

                  <button
                    onClick={() => {
                      stopNavigation();
                      speak("Navigation stopped.");
                    }}
                    style={{
                      background: "rgba(239,68,68,0.15)",
                      color: "#ef4444",
                      border: "2px solid #ef4444",
                      padding: "14px 24px",
                      borderRadius: "12px",
                      fontWeight: 800,
                      fontSize: "15px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      flex: 1,
                      justifyContent: "center",
                    }}
                    aria-label="Stop live GPS navigation"
                  >
                    <span>⏹</span>
                    <span>Stop Navigation</span>
                  </button>
                </div>
              </>
            )}

            {navStatus === "arrived" && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: "56px", marginBottom: "12px" }}>🏁</div>
                <div style={{ fontWeight: 900, color: "#22c55e", fontSize: "24px" }}>
                  You have arrived at your destination!
                </div>
                <div style={{ color: C.text, fontSize: "16px", marginTop: "8px", fontWeight: 600 }}>
                  {destRef.current.label || destination}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────────
           INPUT CARD: Origin, Destination, Transport Modes, and Route Actions
        ─────────────────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "24px", padding: "24px" }}>
          {/* Starting Location (Defaults to Live GPS) */}
          <div style={{ marginBottom: "18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <label style={{ ...s.sec, color: C.text, fontSize: "14px", margin: 0 }}>
                📍 Starting Location
              </label>
              {startLocation ? (
                <button
                  type="button"
                  onClick={() => { setStartLocation(""); speak("Using live GPS location as start origin."); }}
                  style={{ background: "none", border: "none", color: "#a78bfa", fontSize: "13px", cursor: "pointer", fontWeight: 700 }}
                >
                  🔄 Reset to My GPS
                </button>
              ) : (
                <span style={{ fontSize: "12px", color: C.sub }}>
                  {currentPos?.accuracy ? `GPS ±${currentPos.accuracy}m (${currentPos.accuracyTier || "normal"})` : "Defaults to Live GPS"}
                </span>
              )}
            </div>
            <input
              style={{ ...s.input, background: C.input, border: `1.5px solid ${C.inBd}`, color: C.text, width: "100%" }}
              type="text"
              placeholder="Leave blank for automatic live GPS, or enter custom starting address"
              value={startLocation}
              onChange={(e) => setStartLocation(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && startRoute()}
              aria-label="Starting Location"
            />
          </div>

          {/* Destination & Accessible Mic */}
          <div style={{ marginBottom: "18px" }}>
            <label style={{ ...s.sec, color: C.text, fontSize: "14px", display: "block", marginBottom: "8px" }}>
              🎯 Destination
            </label>
            <div style={s.inputRow}>
              <input
                style={{ ...s.input, background: C.input, border: `1.5px solid ${C.inBd}`, color: C.text, flex: 1 }}
                type="text"
                placeholder='Speak or enter destination (e.g. "Chennai Central", "hospital", "Saveetha University")'
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && startRoute()}
                aria-label="Destination input"
              />
              <button
                onClick={startVoiceInput}
                style={{
                  ...s.voiceBtn,
                  ...(voiceListening ? s.voiceBtnActive : {}),
                  width: "56px",
                  height: "56px",
                  fontSize: "24px",
                }}
                aria-label={voiceListening ? "Stop listening" : "Tap to speak destination or command"}
                title="Speak destination"
              >
                {voiceListening ? "⏹" : "🎤"}
              </button>
            </div>
          </div>

          {/* Transport Mode Strip */}
          <div style={{ marginBottom: "20px" }}>
            <div style={{ fontSize: "12px", color: C.sub, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>
              Transport Mode
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
              {MODES.map((m) => {
                const isSelected = transportMode === m.key;
                return (
                  <button
                    key={m.key}
                    onClick={() => changeTransportMode(m.key)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      padding: "14px 10px",
                      borderRadius: "14px",
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all 0.15s ease",
                      border: `2px solid ${isSelected ? "#a78bfa" : C.inBd}`,
                      background: isSelected ? "rgba(167,139,250,0.15)" : C.input,
                      color: isSelected ? "#a78bfa" : C.text,
                    }}
                    aria-label={`Select ${m.label} transport mode`}
                    aria-pressed={isSelected}
                  >
                    <span style={{ fontSize: "28px" }}>{m.icon}</span>
                    <span style={{ fontSize: "14px", fontWeight: isSelected ? 800 : 600 }}>{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => startRoute()}
              disabled={["locating", "geocoding", "routing"].includes(routeStatus) || !destination.trim()}
              style={{
                ...s.routeBtn,
                background: "#8b5cf6",
                color: "#ffffff",
                padding: "14px 24px",
                fontSize: "15px",
                fontWeight: 800,
                flex: "1 1 180px",
              }}
              aria-label="Calculate best route"
            >
              {["locating", "geocoding", "routing"].includes(routeStatus)
                ? "⏳ Calculating…"
                : "🗺️ Get Route"}
            </button>

            {route && !navActive && navStatus !== "arrived" && (
              <button
                onClick={() => startActiveNavigation(route)}
                style={{
                  ...s.startNavBtn,
                  background: "#22c55e",
                  color: "#000000",
                  padding: "14px 24px",
                  fontSize: "15px",
                  fontWeight: 900,
                  flex: "1 1 200px",
                  boxShadow: "0 2px 10px rgba(34,197,94,0.3)",
                }}
                aria-label="Start live GPS turn-by-turn navigation"
              >
                🧭 Start Navigation
              </button>
            )}

            {navActive && (
              <button
                onClick={() => {
                  stopNavigation();
                  speak("Navigation stopped.");
                }}
                style={{
                  ...s.stopNavBtn,
                  padding: "14px 20px",
                  flex: "1 1 180px",
                }}
                aria-label="Stop navigation"
              >
                ⏹ Stop Navigation
              </button>
            )}

            {route && (
              <button
                onClick={() => speakRoute()}
                style={{
                  ...s.speakBtn,
                  padding: "14px 20px",
                }}
                aria-label="Speak full turn by turn route summary"
              >
                🔊 Speak Route
              </button>
            )}

            <button
              onClick={() => openInMaps()}
              disabled={!destination.trim()}
              style={{
                ...s.mapsBtn,
                padding: "14px 20px",
              }}
              aria-label="Open in Google Maps"
            >
              ↗ Google Maps
            </button>

            {(routeStatus !== "idle" || route || nearbyPlaces.length > 0) && (
              <button
                onClick={clearNavigation}
                style={{
                  ...s.clearBtn,
                  padding: "14px 18px",
                }}
                aria-label="Clear navigation"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────────────
           NEARBY SUGGESTING PLACES (Shows all nearby options with Show All)
        ─────────────────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "24px", padding: "22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h3 style={{ ...s.sec, color: C.text, marginBottom: 0, fontSize: "16px" }}>
                📍 Nearby Places & Suggestions
              </h3>
              {nearbyLoading && (
                <span style={{ fontSize: "12px", color: "#a78bfa", fontWeight: 600 }}>📡 Finding places near you…</span>
              )}
              {!nearbyLoading && nearbyPlaces.length > 0 && (
                <span style={{ fontSize: "12px", color: C.sub }}>
                  ({nearbyPlaces.length} found · sorted nearest first)
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {nearbyPlaces.length > 0 && (
                <button
                  type="button"
                  onClick={readNearbyPlacesAloud}
                  style={{ ...s.speakBtn, padding: "8px 14px", fontSize: "13px" }}
                  aria-label="Read nearby places aloud"
                >
                  🔊 Read Places
                </button>
              )}
              <button
                type="button"
                onClick={() => { setNearbyCategory("all"); findNearbyPlaces("all"); }}
                disabled={nearbyLoading}
                style={{
                  background: "#a78bfa",
                  color: "#000000",
                  border: "none",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  fontWeight: 800,
                  fontSize: "13px",
                  cursor: nearbyLoading ? "not-allowed" : "pointer",
                  fontFamily: "Inter,Arial,sans-serif",
                  opacity: nearbyLoading ? 0.6 : 1,
                }}
                aria-label="Find places near me"
              >
                {nearbyLoading ? "⏳ Searching…" : "📍 Find Places Near Me"}
              </button>
            </div>
          </div>

          {/* Category Filter Strip */}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
            {NEARBY_CATEGORIES.map((cat) => {
              const isSelected = nearbyCategory === cat.key;
              return (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => {
                    setNearbyCategory(cat.key);
                    findNearbyPlaces(cat.key);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "7px 14px",
                    borderRadius: "20px",
                    fontSize: "12px",
                    fontWeight: isSelected ? 800 : 500,
                    fontFamily: "Inter,Arial,sans-serif",
                    cursor: "pointer",
                    border: `1.5px solid ${isSelected ? "#a78bfa" : C.inBd}`,
                    background: isSelected ? "rgba(167,139,250,0.18)" : C.input,
                    color: isSelected ? "#a78bfa" : C.text,
                    transition: "all 0.15s ease",
                  }}
                  aria-label={`Filter nearby places by ${cat.label}`}
                  aria-pressed={isSelected}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Error state */}
          {nearbyError && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", color: "#f87171", fontSize: "13px", marginBottom: "14px" }}>
              <span>{nearbyError}</span>
              <button
                type="button"
                onClick={() => { setNearbyError(""); findNearbyPlaces(nearbyCategory); }}
                disabled={nearbyLoading}
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171", padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 700, fontFamily: "inherit" }}
                aria-label="Try finding nearby places again"
              >
                🔄 Try Again
              </button>
            </div>
          )}

          {/* Loading state */}
          {nearbyLoading && (
            <div style={{ color: C.sub, fontSize: "13px", padding: "12px 0" }}>
              📡 Finding nearby places and services…
            </div>
          )}

          {/* Empty state */}
          {!nearbyLoading && !nearbyError && nearbyPlaces.length === 0 && nearbySearched && (
            <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0" }}>
              <span style={{ color: C.sub, fontSize: "13px" }}>No nearby places found in this area.</span>
              <button
                type="button"
                onClick={() => findNearbyPlaces(nearbyCategory)}
                style={{ background: C.input, border: `1px solid ${C.inBd}`, color: C.sub, padding: "6px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "12px", fontWeight: 600, fontFamily: "inherit" }}
                aria-label="Try searching again"
              >
                🔄 Try Again
              </button>
            </div>
          )}

          {/* Initial prompt */}
          {!nearbyLoading && !nearbyError && nearbyPlaces.length === 0 && !nearbySearched && (
            <div style={{ color: C.sub, fontSize: "13px", padding: "8px 0" }}>
              Press <strong>Find Places Near Me</strong> or tap any category above to view nearby hospitals, pharmacies, ATMs, bus stops, and more.
            </div>
          )}

          {/* Grid of Nearby Place Cards with Show All */}
          {(() => {
            const filtered = nearbyCategory === "all"
              ? nearbyPlaces
              : nearbyPlaces.filter((p) => p.amenity === nearbyCategory);
            const shown = nearbyExpanded ? filtered : filtered.slice(0, 5);
            if (!shown.length) return null;

            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "12px" }}>
                  {shown.map((p, idx) => {
                    const icon = AMENITY_ICON[p.amenity] || "📍";
                    const distM = p.distM ?? (currentPos ? haversineM(currentPos.lat, currentPos.lon, p.lat, p.lon) : null);
                    const distLabel = distM == null ? null
                      : distM < 1000 ? `${Math.round(distM)} m`
                      : `${(distM / 1000).toFixed(1)} km`;

                    return (
                      <div
                        key={p.id || idx}
                        style={{
                          background: isDark ? "rgba(255,255,255,0.03)" : "#ffffff",
                          border: `2px solid ${C.border}`,
                          borderRadius: "14px",
                          padding: "16px",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          boxShadow: isDark ? "none" : "0 2px 8px rgba(0,0,0,0.04)",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                        }}
                        onClick={() => {
                          speak(`Navigating to ${p.name}.`);
                          startRouteToCoords(p.lat, p.lon, p.name);
                        }}
                        role="button"
                        tabIndex={0}
                        aria-label={`${p.name}, ${(p.amenity || "").replace(/_/g, " ")}${distLabel ? ", " + distLabel + " away" : ""}. Click to navigate.`}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && startRouteToCoords(p.lat, p.lon, p.name)}
                      >
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                            <span style={{ fontSize: "24px" }}>{icon}</span>
                            <span style={{ fontWeight: 800, color: C.text, fontSize: "15px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                              {p.name}
                            </span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <span style={{ fontSize: "12px", color: C.sub, textTransform: "capitalize", fontWeight: 600 }}>
                              {(p.amenity || "").replace(/_/g, " ")}
                            </span>
                            {distLabel && (
                              <span style={{
                                fontSize: "13px",
                                fontWeight: 800,
                                color: distM < 500 ? "#22c55e" : distM < 2000 ? "#8b5cf6" : C.sub,
                              }}>
                                {distLabel}
                              </span>
                            )}
                          </div>
                          {p.address && (
                            <div style={{ fontSize: "11px", color: C.sub, marginBottom: "12px", lineHeight: "1.3", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                              {p.address}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            speak(`Navigating to ${p.name}.`);
                            startRouteToCoords(p.lat, p.lon, p.name);
                          }}
                          style={{
                            width: "100%",
                            background: "rgba(139,92,246,0.15)",
                            border: "1.5px solid #8b5cf6",
                            color: isDark ? "#c4b5fd" : "#6d28d9",
                            padding: "10px 0",
                            borderRadius: "10px",
                            cursor: "pointer",
                            fontSize: "13px",
                            fontWeight: 800,
                            fontFamily: "inherit",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            transition: "background 0.15s ease",
                          }}
                          aria-label={`Navigate to ${p.name}`}
                        >
                          <span>🗺️</span>
                          <span>Navigate</span>
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Show All / Show Fewer Button */}
                {filtered.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setNearbyExpanded((v) => !v)}
                    style={{
                      marginTop: "16px",
                      background: C.input,
                      border: `1.5px solid ${C.inBd}`,
                      color: C.text,
                      padding: "10px 20px",
                      borderRadius: "12px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: 700,
                      fontFamily: "inherit",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                    aria-label={nearbyExpanded ? "Show fewer nearby places" : `Show all ${filtered.length} nearby places`}
                  >
                    <span>{nearbyExpanded ? "▲" : "▼"}</span>
                    <span>{nearbyExpanded ? "Show fewer" : `Show all ${filtered.length} nearby places`}</span>
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {/* ───────────────────────────────────────────────────────────────────
           ROUTE DETAILS & TURN-BY-TURN STEPS CARD
        ─────────────────────────────────────────────────────────────────── */}
        {route && (
          <div style={{ ...s.routeCard, background: C.card, border: `1.5px solid ${C.border}`, padding: "24px" }}>
            {/* Origin -> Destination summary */}
            <div style={s.routeSummary}>
              <div style={s.summaryItem}>
                <span style={s.summaryIcon}>📍</span>
                <div>
                  <div style={{ fontSize: "11px", color: C.sub, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>From</div>
                  <div style={{ fontSize: "14px", color: C.text, fontWeight: 700 }}>{route.fromLabel}</div>
                </div>
              </div>
              <div style={{ color: "#a78bfa", fontSize: "22px", fontWeight: 900 }}>→</div>
              <div style={s.summaryItem}>
                <span style={s.summaryIcon}>🏁</span>
                <div>
                  <div style={{ fontSize: "11px", color: C.sub, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>To</div>
                  <div style={{ fontSize: "14px", color: C.text, fontWeight: 700 }}>{route.destLabel}</div>
                </div>
              </div>
            </div>

            {/* Metrics */}
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
                <div style={s.statVal}>{MODES.find((m) => m.key === transportMode)?.icon} {route.mode}</div>
                <div style={s.statLabel}>Transport</div>
              </div>
            </div>

            {route.noLiveTraffic && (
              <div style={{ fontSize: "12px", color: C.sub, marginTop: "10px" }}>
                ⓘ Note: Based on standard road limits without live traffic conditions.
              </div>
            )}

            {/* Steps list */}
            <div style={{ marginTop: "24px" }}>
              <div style={{ fontSize: "14px", color: C.sub, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "14px" }}>
                Turn-by-Turn Steps ({route.steps.length} total)
              </div>
              <div style={s.stepsList}>
                {route.steps.map((step, i) => {
                  const isActive = navActive && i === currentStepIdx;
                  const isCompleted = stepStates[i] === "completed";
                  return (
                    <div
                      key={i}
                      style={{
                        ...s.step,
                        background: isActive
                          ? "rgba(167,139,250,0.18)"
                          : isCompleted
                          ? "rgba(34,197,94,0.08)"
                          : step.type === "arrive"
                          ? "rgba(34,197,94,0.1)"
                          : "rgba(167,139,250,0.05)",
                        border: `1.5px solid ${
                          isActive
                            ? "#a78bfa"
                            : isCompleted
                            ? "rgba(34,197,94,0.3)"
                            : step.type === "arrive"
                            ? "rgba(34,197,94,0.3)"
                            : "rgba(167,139,250,0.12)"
                        }`,
                        opacity: isCompleted ? 0.6 : 1,
                        padding: "14px 16px",
                      }}
                      onClick={() =>
                        speak(`Step ${i + 1}: ${step.instruction}${step.name ? " onto " + step.name : ""}. ${fmtDist(step.distance)}.`)
                      }
                      title="Tap to hear this instruction aloud"
                      role="button"
                      tabIndex={0}
                    >
                      <div style={{ ...s.stepIcon, fontSize: "26px" }}>{step.icon}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: C.text, fontSize: "15px" }}>
                          {step.instruction}
                          {step.name && <span style={{ color: "#a78bfa" }}> onto {step.name}</span>}
                        </div>
                        {step.type !== "arrive" && (
                          <div style={{ fontSize: "12px", color: C.sub, marginTop: "4px", fontWeight: 600 }}>
                            {fmtDist(step.distance)} · {fmtTime(step.duration)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                        <div style={{ fontSize: "12px", color: "#a78bfa", fontWeight: 800 }}>#{i + 1}</div>
                        {isCompleted && <div style={{ fontSize: "12px", color: "#22c55e", fontWeight: 800 }}>✓ Done</div>}
                        {isActive && <div style={{ fontSize: "12px", color: "#a78bfa", fontWeight: 800 }}>▶ Active</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────────
           QUICK DESTINATIONS
        ─────────────────────────────────────────────────────────────────── */}
        <div className="card" style={{ marginBottom: "24px", padding: "20px" }}>
          <h3 style={{ ...s.sec, color: C.text, fontSize: "15px", marginBottom: "14px" }}>
            ⚡ Quick Navigate (Nearest Essential Services)
          </h3>
          <div style={s.quickGrid}>
            {[
              { label: "🏥 Hospital",        tag: "hospital",      q: "hospital near me"        },
              { label: "💊 Pharmacy",        tag: "pharmacy",      q: "pharmacy near me"        },
              { label: "🏧 ATM",             tag: "atm",           q: "ATM near me"             },
              { label: "👮 Police Station",  tag: "police",        q: "police station near me"  },
              { label: "🚌 Bus Stop",        tag: "bus_stop",      q: "bus stop near me"        },
              { label: "🚉 Railway Station", tag: "train_station", q: "railway station near me" },
              { label: "🛒 Supermarket",     tag: "supermarket",   q: "supermarket near me"     },
              { label: "🏦 Bank",            tag: "bank",          q: "bank near me"            },
              { label: "⛽ Petrol Station",  tag: "fuel",          q: "petrol station near me"  },
              { label: "🍽️ Restaurant",      tag: "restaurant",    q: "restaurant near me"      },
              { label: "🏫 School",          tag: "school",        q: "school near me"          },
            ].map((p) => (
              <button
                key={p.q}
                type="button"
                onClick={() => {
                  setDestination(p.q);
                  setNearbyCategory(p.tag);
                  startRoute(p.q);
                  findNearbyPlaces(p.tag);
                }}
                style={{
                  ...s.quickBtn,
                  background: C.input,
                  border: `1.5px solid ${C.inBd}`,
                  color: C.text,
                }}
                aria-label={`Navigate to nearest ${p.label}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* ───────────────────────────────────────────────────────────────────
           SAVED LOCATIONS
        ─────────────────────────────────────────────────────────────────── */}
        {savedLocations.length > 0 && (
          <div className="card" style={{ marginBottom: "24px", padding: "20px" }}>
            <h3 style={{ ...s.sec, color: C.text, fontSize: "15px", marginBottom: "14px" }}>
              ⭐ Saved Locations
            </h3>
            <div style={s.quickGrid}>
              {savedLocations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    setDestination(loc.place_name);
                    startRoute(loc.place_name);
                  }}
                  style={{
                    ...s.quickBtn,
                    background: "rgba(34,197,94,0.06)",
                    border: "1.5px solid rgba(34,197,94,0.25)",
                    color: C.text,
                  }}
                  aria-label={`Navigate to ${loc.place_name}`}
                >
                  📍 {loc.place_name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ───────────────────────────────────────────────────────────────────
           RECENT DESTINATIONS HISTORY
        ─────────────────────────────────────────────────────────────────── */}
        {requests.length > 0 && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h3 style={{ ...s.sec, color: C.text, marginBottom: 0 }}>Recent Destinations</h3>
              <span className="pill pill-purple">{requests.length}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {requests.slice(0, 6).map((req) => (
                <div key={req.id} style={{ ...s.histCard, background: C.card, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: "20px" }}>📍</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: C.text, fontSize: "14px" }}>{req.destination}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDestination(req.destination);
                      startRoute(req.destination);
                    }}
                    style={s.histNav}
                    aria-label={`Navigate again to ${req.destination}`}
                  >
                    🗺️ Route
                  </button>
                  <button type="button" onClick={() => deleteRequest(req.id)} style={s.histDel} aria-label="Delete history entry">
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   STYLES
───────────────────────────────────────────────────────────────────────────── */
const s = {
  sec:        { fontSize: "16px", fontWeight: 700, marginBottom: "14px" },
  inputRow:   { display: "flex", gap: "10px", alignItems: "center" },
  input:      { padding: "14px 16px", borderRadius: "12px", fontSize: "15px", fontFamily: "Inter,Arial,sans-serif", outline: "none" },
  voiceBtn:   { background: "rgba(250,204,21,0.12)", border: "2px solid #facc15", color: "#facc15", borderRadius: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontFamily: "inherit", transition: "all 0.15s" },
  voiceBtnActive: { background: "rgba(239,68,68,0.18)", borderColor: "#ef4444", color: "#ef4444" },
  routeBtn:   { border: "none", borderRadius: "12px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  startNavBtn:{ border: "none", borderRadius: "12px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  stopNavBtn: { background: "rgba(239,68,68,0.12)", color: "#ef4444", border: "2px solid #ef4444", borderRadius: "12px", fontWeight: 800, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  mapsBtn:    { background: "rgba(96,165,250,0.1)", border: "1.5px solid rgba(96,165,250,0.3)", color: "#60a5fa", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif", display: "flex", alignItems: "center", gap: "6px" },
  speakBtn:   { background: "rgba(250,204,21,0.1)", border: "1.5px solid rgba(250,204,21,0.3)", color: "#facc15", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  clearBtn:   { background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)", color: "#f87171", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", fontFamily: "Inter,Arial,sans-serif" },
  navPanel:   { borderRadius: "16px", padding: "20px" },
  routeCard:  { borderRadius: "16px", marginBottom: "24px" },
  routeSummary: { display: "flex", alignItems: "center", gap: "14px", marginBottom: "18px", flexWrap: "wrap" },
  summaryItem:  { display: "flex", alignItems: "center", gap: "10px" },
  summaryIcon:  { fontSize: "24px" },
  statsRow:   { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" },
  stat:       { textAlign: "center", padding: "12px 8px", background: "rgba(167,139,250,0.08)", borderRadius: "12px", border: "1px solid rgba(167,139,250,0.15)" },
  statVal:    { fontWeight: 800, fontSize: "17px", color: "#a78bfa", marginBottom: "4px" },
  statLabel:  { fontSize: "11px", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 },
  stepsList:  { display: "flex", flexDirection: "column", gap: "10px" },
  step:       { display: "flex", alignItems: "center", gap: "14px", borderRadius: "12px", cursor: "pointer", transition: "opacity 0.15s" },
  stepIcon:   { width: "36px", textAlign: "center", flexShrink: 0 },
  quickGrid:  { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "10px" },
  quickBtn:   { padding: "14px 10px", borderRadius: "12px", cursor: "pointer", fontWeight: 700, fontSize: "13px", fontFamily: "Inter,Arial,sans-serif", textAlign: "center", transition: "all 0.15s" },
  histCard:   { display: "flex", alignItems: "center", gap: "12px", padding: "14px 16px", borderRadius: "12px", borderLeft: "4px solid #a78bfa" },
  histNav:    { background: "rgba(167,139,250,0.1)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa", padding: "8px 14px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontWeight: 700, fontFamily: "inherit", flexShrink: 0 },
  histDel:    { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171", padding: "8px 12px", borderRadius: "8px", cursor: "pointer", fontSize: "13px", fontFamily: "inherit", flexShrink: 0 },
};
