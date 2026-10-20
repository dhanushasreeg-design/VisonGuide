/**
 * routingService.js
 * 
 * Free, open-source routing and nearby location helper for VisionGuide AI.
 * STRICT REQUIREMENT: ZERO third-party API keys or paid services.
 * Uses public OpenStreetMap infrastructure (routed-foot, routed-bike, OSRM public demo, Nominatim).
 */

export const ROUTING_MODES = [
  {
    key: "foot",
    label: "Walk",
    icon: "🚶",
    osrm: "foot",
    endpoints: [
      "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
      "https://router.project-osrm.org/route/v1/driving",
    ],
    gmapsDirflg: "w",
    travelmode: "walking",
  },
  {
    key: "cycling",
    label: "Bike",
    icon: "🚲",
    osrm: "cycling",
    endpoints: [
      "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
      "https://router.project-osrm.org/route/v1/driving",
    ],
    gmapsDirflg: "b",
    travelmode: "bicycling",
  },
  {
    key: "driving",
    label: "Car",
    icon: "🚗",
    osrm: "driving",
    endpoints: [
      "https://router.project-osrm.org/route/v1/driving",
      "https://routing.openstreetmap.de/routed-car/route/v1/driving",
    ],
    gmapsDirflg: "d",
    travelmode: "driving",
  },
];

export const WALK_SPEED_MPS = 1.4;  // ~5.0 km/h walking speed
export const CYCLE_SPEED_MPS = 4.2; // ~15.1 km/h cycling speed

/**
 * Calculates Haversine distance in metres between two coordinates.
 */
export const haversineM = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

/**
 * Calculates Haversine distance in kilometres.
 */
export const haversineKm = (lat1, lon1, lat2, lon2) => {
  return haversineM(lat1, lon1, lat2, lon2) / 1000;
};

/**
 * Clean, natural distance phrasing formatted specifically for Text-to-Speech screen reading.
 */
export const formatDistanceForSpeech = (distM) => {
  if (distM == null || isNaN(distM)) return "";
  const d = Math.round(distM);
  if (d < 50) return "just steps away";
  if (d < 1000) return `${d} metres away`;
  const km = (d / 1000).toFixed(1);
  return `${km} kilometres away`;
};

/**
 * Extracts and formats human-readable address from either Nominatim address objects or OSM tags.
 */
export const buildCleanAddress = (obj = {}) => {
  if (!obj) return "";
  const parts = [];
  const houseNum = obj["addr:housenumber"] || obj.house_number;
  const street = obj["addr:street"] || obj.road || obj.street || obj.pedestrian || obj.footway;
  if (houseNum && street) parts.push(`${houseNum} ${street}`);
  else if (street) parts.push(street);

  const locality = obj["addr:suburb"] || obj["addr:neighbourhood"] || obj.suburb || obj.neighbourhood || obj.residential;
  if (locality) parts.push(locality);

  const city = obj["addr:city"] || obj["addr:town"] || obj["addr:village"] || obj.city || obj.town || obj.village;
  if (city) parts.push(city);

  const state = obj["addr:state"] || obj.state;
  if (state) parts.push(state);

  const postcode = obj["addr:postcode"] || obj.postcode;
  if (postcode) parts.push(postcode);

  return parts.join(", ");
};

/**
 * Sanitizes and cleans a place name for TTS audio output so blind users hear a meaningful label.
 */
export const cleanPlaceName = (name, amenity = "", displayStr = "") => {
  let cleaned = (name || "").trim();
  if (!cleaned && displayStr) {
    cleaned = displayStr.split(",")[0].trim();
  }
  const isGeneric = !cleaned || /^(hospital|clinic|pharmacy|atm|bank|supermarket|school|restaurant|bus stop|police station|unnamed|n\/?a|amenity)$/i.test(cleaned);
  if (isGeneric && displayStr) {
    const segments = displayStr.split(",").map(s => s.trim()).filter(Boolean);
    if (segments.length > 1) {
      cleaned = `${segments[0]} (${segments[1]})`;
    }
  }
  if (!cleaned) {
    cleaned = (amenity || "Place").replace(/_/g, " ");
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  return cleaned;
};

/**
 * Classifies GPS hardware accuracy radius into usability tiers.
 */
export const classifyAccuracy = (accuracyMeters) => {
  if (accuracyMeters == null || isNaN(accuracyMeters) || accuracyMeters <= 0) {
    return { tier: "unknown", accuracy: null, label: "Accuracy unknown", advisory: "" };
  }
  const acc = Math.round(accuracyMeters);
  if (acc <= 35) {
    return { tier: "high", accuracy: acc, label: "High accuracy (GPS fix)", advisory: "" };
  }
  if (acc <= 100) {
    return {
      tier: "moderate",
      accuracy: acc,
      label: `Moderate accuracy (~${acc}m)`,
      advisory: `GPS accuracy is approximately ${acc} metres.`,
    };
  }
  return {
    tier: "weak",
    accuracy: acc,
    label: `Weak signal (~${acc}m)`,
    advisory: `GPS accuracy is approximate, about ${acc} metres. Live navigation steps may update with slight delay.`,
  };
};

/**
 * Computes adaptive off-route threshold based on GPS sensor accuracy.
 * Suppresses false rerouting loops when GPS accuracy is degraded.
 */
export const computeDynamicOffRouteThreshold = (baseThreshold = 80, accuracyMeters = 0) => {
  const acc = Math.max(0, Number(accuracyMeters) || 0);
  if (acc > 150) {
    return Infinity;
  }
  return Math.max(baseThreshold, acc * 1.5);
};

/**
 * Validates whether arrival can be safely announced.
 */
export const checkArrivalEligibility = (currentStepIdx, totalSteps, distanceToDestM, arrivalThresholdM = 30) => {
  if (distanceToDestM == null || isNaN(distanceToDestM) || distanceToDestM > arrivalThresholdM) {
    return false;
  }
  if (totalSteps <= 2) return true;
  return currentStepIdx >= totalSteps - 2;
};

/**
 * Returns honest duration estimate for pedestrian and cycling modes.
 */
export const estimateTravelDuration = (modeKey, distanceM, engineDuration) => {
  const dist = Math.max(0, Number(distanceM) || 0);
  if (modeKey === "foot") {
    const nominal = dist / WALK_SPEED_MPS;
    if (engineDuration && engineDuration >= nominal * 0.6) {
      return { duration: engineDuration, isEstimate: false };
    }
    return { duration: nominal, isEstimate: true };
  }
  if (modeKey === "cycling") {
    const nominal = dist / CYCLE_SPEED_MPS;
    if (engineDuration && engineDuration >= nominal * 0.6) {
      return { duration: engineDuration, isEstimate: false };
    }
    return { duration: nominal, isEstimate: true };
  }
  return { duration: engineDuration || (dist / 10), isEstimate: false };
};

/**
 * Validates coordinate pair.
 */
export const isValidCoordinate = (lat, lon) => {
  if (typeof lat !== "number" || typeof lon !== "number") return false;
  if (isNaN(lat) || isNaN(lon)) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;
  return true;
};

/**
 * Categorization dictionary for fast OpenStreetMap POI queries without API keys.
 */
export const NEARBY_TAG_MAP = {
  hospital: {
    primary: "hospital",
    alternates: ["clinic", "healthcare center"],
    overpass: '["amenity"~"^(hospital|clinic)$"]',
  },
  pharmacy: {
    primary: "pharmacy",
    alternates: ["medical store", "chemist"],
    overpass: '["amenity"="pharmacy"]',
  },
  atm: {
    primary: "atm",
    alternates: ["cash machine"],
    overpass: '["amenity"="atm"]',
  },
  police: {
    primary: "police station",
    alternates: ["police"],
    overpass: '["amenity"="police"]',
  },
  bus_stop: {
    primary: "bus stop",
    alternates: ["bus station"],
    overpass: '["highway"="bus_stop"]',
  },
  train_station: {
    primary: "railway station",
    alternates: ["train station", "metro station"],
    overpass: '["railway"~"^(station|halt)$"]',
  },
  bank: {
    primary: "bank",
    alternates: [],
    overpass: '["amenity"="bank"]',
  },
  restaurant: {
    primary: "restaurant",
    alternates: ["food", "cafe"],
    overpass: '["amenity"~"^(restaurant|cafe)$"]',
  },
  supermarket: {
    primary: "supermarket",
    alternates: ["grocery"],
    overpass: '["shop"~"^(supermarket|convenience|grocery)$"]',
  },
  school: {
    primary: "school",
    alternates: ["college"],
    overpass: '["amenity"~"^(school|college)$"]',
  },
};

/**
 * Fast, reliable POI lookup using OpenStreetMap Nominatim bounded viewbox search.
 * Strictly 100% free and requires zero API keys.
 */
export const searchNearbyPlaces = async (category = "all", userLat, userLon, options = {}) => {
  if (!isValidCoordinate(userLat, userLon)) {
    throw new Error("Valid GPS coordinates are required to find nearby places.");
  }

  const radiusKm = options.radiusKm || 8;
  const delta = radiusKm / 111.32;
  const deltaLon = delta / Math.max(0.1, Math.cos((userLat * Math.PI) / 180));
  const bbox = `${userLon - deltaLon},${userLat + delta},${userLon + deltaLon},${userLat - delta}`;

  const queryNominatimSingle = async (queryText, limit = 8) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryText)}&format=jsonv2&limit=${limit}&viewbox=${bbox}&bounded=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "VisionGuideAI/1.0 (Accessibility Assistant)" },
      signal: AbortSignal.timeout(options.timeoutMs || 5000),
    });
    if (!res.ok) throw new Error(`Search service error: ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  };

  let rawPlaces = [];

  if (category === "all") {
    // Parallel query top essential necessities for visually impaired people
    const essentials = [
      { tag: "hospital", q: "hospital" },
      { tag: "pharmacy", q: "pharmacy" },
      { tag: "bus_stop", q: "bus stop" },
      { tag: "atm", q: "atm" },
      { tag: "supermarket", q: "supermarket" },
      { tag: "police", q: "police station" },
    ];

    const promises = essentials.map(async (item) => {
      try {
        const items = await queryNominatimSingle(item.q, 3);
        return items.map(p => ({ ...p, _amenity: item.tag }));
      } catch {
        return [];
      }
    });

    const nested = await Promise.all(promises);
    rawPlaces = nested.flat();
  } else {
    const config = NEARBY_TAG_MAP[category] || { primary: category.replace(/_/g, " "), alternates: [] };
    try {
      rawPlaces = await queryNominatimSingle(config.primary, 15);
      rawPlaces = rawPlaces.map(p => ({ ...p, _amenity: category }));
    } catch {
      rawPlaces = [];
    }

    // If initial query was sparse, try alternate search terms
    if (rawPlaces.length < 3 && config.alternates?.length) {
      for (const alt of config.alternates) {
        try {
          const extra = await queryNominatimSingle(alt, 8);
          rawPlaces.push(...extra.map(p => ({ ...p, _amenity: category })));
          if (rawPlaces.length >= 5) break;
        } catch {}
      }
    }
  }

  // Deduplicate and compute true Haversine distance from user
  const seenKeys = new Set();
  const parsed = [];

  for (const item of rawPlaces) {
    const lat = parseFloat(item.lat);
    const lon = parseFloat(item.lon);
    if (!isValidCoordinate(lat, lon)) continue;

    const distM = haversineM(userLat, userLon, lat, lon);
    const address = buildCleanAddress(item.address) || item.display_name || "";
    const name = cleanPlaceName(item.name, item._amenity || category, item.display_name);

    // Coordinate hash key to deduplicate identical physical nodes/ways
    const coordKey = `${Math.round(lat * 1000)}_${Math.round(lon * 1000)}_${name.toLowerCase().slice(0, 10)}`;
    if (seenKeys.has(coordKey)) continue;
    seenKeys.add(coordKey);

    parsed.push({
      id: item.place_id || item.osm_id || `${lat}_${lon}`,
      name,
      amenity: item._amenity || category,
      address,
      lat,
      lon,
      distM,
      formattedDist: formatDistanceForSpeech(distM),
    });
  }

  parsed.sort((a, b) => a.distM - b.distM);
  return parsed.slice(0, 15);
};
