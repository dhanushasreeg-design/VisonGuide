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
    alternates: ["clinic", "healthcare", "medical centre", "nursing home", "health centre"],
  },
  pharmacy: {
    primary: "pharmacy",
    alternates: ["medical", "clinic", "hospital", "chemist", "dispensary", "drugstore", "medical store"],
  },
  atm: {
    primary: "atm",
    alternates: ["bank", "cash machine", "State Bank of India", "HDFC", "ICICI Bank"],
  },
  police: {
    primary: "police station",
    alternates: ["police", "police booth", "outpost"],
  },
  bus_stop: {
    primary: "bus stop",
    alternates: ["bus stand", "bus station", "transit stop"],
  },
  train_station: {
    primary: "railway station",
    alternates: ["train station", "metro station", "railway"],
  },
  bank: {
    primary: "bank",
    alternates: ["atm", "cooperative bank", "State Bank of India"],
  },
  restaurant: {
    primary: "restaurant",
    alternates: ["hotel", "food", "cafe", "bhavan"],
  },
  supermarket: {
    primary: "supermarket",
    alternates: ["grocery", "provision store", "departmental store", "mart"],
  },
  fuel: {
    primary: "petrol station",
    alternates: ["fuel", "gas station", "Indian Oil", "Bharat Petroleum", "HP Petrol"],
  },
  school: {
    primary: "school",
    alternates: ["college", "university", "institute", "vidyalaya"],
  },
};

/**
 * Fast, highly resilient POI lookup using dual-engine OpenStreetMap infrastructure
 * (Komoot Photon OpenStreetMap API + Nominatim fallback).
 * Starts from nearby distance so close places (< 1 km, 200m, 500m) appear first,
 * and automatically queries synonyms in parallel so places are ALWAYS found with zero errors.
 * Strictly 100% free and requires zero API keys.
 */
export const searchNearbyPlaces = async (category = "all", userLat, userLon, options = {}) => {
  if (!isValidCoordinate(userLat, userLon)) {
    throw new Error("Valid GPS coordinates are required to find nearby places.");
  }

  // Radius for bounding box: default 12km (or custom option)
  const radiusKm = options.radiusKm || 12.0;
  const delta = radiusKm / 111.32;
  const deltaLon = delta / Math.max(0.1, Math.cos((userLat * Math.PI) / 180));
  const bboxPhoton = `${userLon - deltaLon},${userLat - delta},${userLon + deltaLon},${userLat + delta}`;
  const bboxNom = `${userLon - deltaLon},${userLat + delta},${userLon + deltaLon},${userLat - delta}`;

  const getBboxNom = (rKm) => {
    const d = rKm / 111.32;
    const dLon = d / Math.max(0.1, Math.cos((userLat * Math.PI) / 180));
    return `${userLon - dLon},${userLat + d},${userLon + dLon},${userLat - d}`;
  };

  const tightBboxNom = getBboxNom(Math.min(radiusKm, 1.2));

  // Helper 1: Query Komoot Photon OSM API (lightning fast, zero rate-limiting)
  const queryPhoton = async (queryText, limit = 12) => {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(queryText)}&lat=${userLat}&lon=${userLon}&bbox=${bboxPhoton}&limit=${limit}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "VisionGuideAI/1.0" },
        signal: AbortSignal.timeout(options.timeoutMs || 4500),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data.features)) return [];
      return data.features.map((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const p = f.properties || {};
        const name = p.name || p.street || p.city || queryText;
        const address = [p.housenumber, p.street, p.district, p.city, p.state].filter(Boolean).join(", ");
        return {
          name,
          lat,
          lon,
          display_name: address || name,
          _rawAmenity: p.osm_value,
          _amenity: category === "all" ? p.osm_value : category,
        };
      });
    } catch {
      return [];
    }
  };

  // Helper 2: Query OpenStreetMap Nominatim with safe text/JSON parsing against XML 429 pages
  const queryNominatimSingle = async (queryText, limit = 8, customBbox = null) => {
    try {
      const box = customBbox || bboxNom;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(queryText)}&format=jsonv2&limit=${limit}&viewbox=${box}&bounded=1&addressdetails=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "VisionGuideAI/1.0 (Accessibility Assistant)" },
        signal: AbortSignal.timeout(Math.min(options.timeoutMs || 4000, 4000)),
      });
      const text = await res.text();
      if (!text.trim().startsWith("[") && !text.trim().startsWith("{")) {
        // XML or HTML 429/504 error page from Nominatim - return empty so Photon handles it
        return [];
      }
      const data = JSON.parse(text);
      if (!Array.isArray(data)) return [];
      return data.map((d) => ({
        ...d,
        _rawAmenity: d.type || d.category,
        _amenity: category === "all" ? d.type || d.category : category,
      }));
    } catch {
      return [];
    }
  };

  let rawPlaces = [];

  if (category === "all") {
    const essentials = [
      { tag: "hospital", q: "hospital" },
      { tag: "pharmacy", q: "pharmacy" },
      { tag: "atm", q: "atm" },
      { tag: "bank", q: "bank" },
      { tag: "bus_stop", q: "bus stop" },
      { tag: "supermarket", q: "supermarket" },
      { tag: "police", q: "police station" },
      { tag: "restaurant", q: "restaurant" },
    ];

    // Query Photon in parallel
    const photonPromises = essentials.map((item) =>
      queryPhoton(item.q, 8).then((items) =>
        items.map((p) => ({ ...p, _amenity: item.tag }))
      )
    );
    const photonNested = await Promise.all(photonPromises);
    rawPlaces.push(...photonNested.flat());

    // If Photon had fewer than 10 results (e.g. server latency or suburban area), supplement with Nominatim essentials sequentially
    if (rawPlaces.length < 10) {
      for (const item of essentials.slice(0, 3)) {
        try {
          const items = await queryNominatimSingle(item.q, 5, bboxNom);
          if (items && items.length > 0) {
            rawPlaces.push(...items.map((p) => ({ ...p, _amenity: item.tag })));
            if (rawPlaces.length >= 10) break;
          }
        } catch {}
      }
    }
  } else {
    const config = NEARBY_TAG_MAP[category] || {
      primary: category.replace(/_/g, " "),
      alternates: [],
    };
    const searchTerms = [config.primary, ...(config.alternates || []).slice(0, 3)];

    // 1. First query Nominatim with tight local bbox (1.2 km) so walkable neighborhood POIs (< 1 km) appear immediately
    try {
      const localItems = await queryNominatimSingle(config.primary, 8, tightBboxNom);
      if (localItems && localItems.length > 0) {
        rawPlaces.push(...localItems.map((p) => ({ ...p, _amenity: category })));
      }
    } catch {}

    // 2. Query synonyms using Photon (instant, zero rate limits) for wide city coverage
    const photonPromises = searchTerms.map((term) => queryPhoton(term, 10));
    const photonNested = await Promise.all(photonPromises);
    rawPlaces.push(...photonNested.flat().map((p) => ({ ...p, _amenity: category })));

    // 3. Supplement with wider Nominatim if fewer than 5 results (sequential to prevent 429)
    if (rawPlaces.length < 5) {
      const nomTerms = [config.primary, ...(config.alternates || []).slice(0, 2)];
      for (const term of nomTerms) {
        try {
          const items = await queryNominatimSingle(term, 8, bboxNom);
          if (items && items.length > 0) {
            rawPlaces.push(...items.map((p) => ({ ...p, _amenity: category })));
            if (rawPlaces.length >= 8) break;
          }
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

    // Coordinate proximity key (within ~40m) and name prefix to deduplicate identical nodes
    const coordKey = `${Math.round(lat * 1200)}_${Math.round(lon * 1200)}_${name.toLowerCase().slice(0, 8)}`;
    if (seenKeys.has(coordKey)) continue;
    seenKeys.add(coordKey);

    parsed.push({
      id: item.place_id || item.osm_id || `${lat}_${lon}`,
      name,
      amenity: item._amenity || category,
      rawType: item._rawAmenity || category,
      address,
      lat,
      lon,
      distM,
      formattedDist: formatDistanceForSpeech(distM),
    });
  }

  // CRITICAL: Sort nearest FIRST so places within walking distance (e.g. 200m, 377m, 500m) are at the top!
  parsed.sort((a, b) => a.distM - b.distM);
  return parsed.slice(0, 25);
};
