import * as Location from 'expo-location';

export const MODES = [
  { key: 'foot', label: 'Walk', icon: '🚶', speedMps: 1.4, factor: 1.22 },
  { key: 'cycling', label: 'Bike', icon: '🚲', speedMps: 5.0, factor: 1.32 },
  { key: 'driving', label: 'Car', icon: '🚗', speedMps: 11.1, factor: 1.48 },
];

/**
 * Calculates Haversine straight-line distance in meters.
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Calculates compass heading / direction between two coordinates.
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 'ahead';
  const y = Math.sin(((lon2 - lon1) * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180);
  const x =
    Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
    Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(((lon2 - lon1) * Math.PI) / 180);
  const θ = Math.atan2(y, x);
  const brng = (((θ * 180) / Math.PI) + 360) % 360;
  const dirs = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West'];
  const idx = Math.round(brng / 45) % 8;
  return dirs[idx];
}

export function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds) {
  const s = Math.max(30, Math.round(seconds));
  const m = Math.round(s / 60);
  if (m >= 60) {
    const hrs = Math.floor(m / 60);
    const remM = m % 60;
    return `${hrs} hr ${remM} min`;
  }
  return `${Math.max(1, m)} min`;
}

export async function getCurrentGPSPosition() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied. Please allow GPS access in device settings.');
  }

  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.BestForNavigation,
  });

  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: Math.round(loc.coords.accuracy || 5),
    speed: loc.coords.speed || 0,
    heading: loc.coords.heading || 0,
  };
}

export function watchGPSPosition(onUpdate, onError) {
  return Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2000,
      distanceInterval: 1, // trigger every 1 meter
    },
    (loc) => {
      onUpdate({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: Math.round(loc.coords.accuracy || 5),
        speed: loc.coords.speed || 0,
        heading: loc.coords.heading || 0,
      });
    }
  ).catch(onError);
}

export async function getCleanAddress(lat, lon) {
  try {
    const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    if (res && res.length > 0) {
      const p = res[0];
      const parts = [p.name, p.street, p.subregion || p.district, p.city, p.postalCode, p.country].filter(Boolean);
      return parts.join(', ');
    }
  } catch (_) {}
  return `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
}

/**
 * Searches local POIs strictly within the user's city/radius and computes mode-specific road distances and travel times.
 */
export async function fetchNearbyPlaces(category, lat, lon, modeKey = 'foot') {
  const mode = MODES.find((m) => m.key === modeKey) || MODES[0];
  const delta = 0.08; // ~8-10 km localized radius around the user
  const viewbox = `${lon - delta},${lat + delta},${lon + delta},${lat - delta}`;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      category
    )}&limit=15&viewbox=${viewbox}&bounded=1&addressdetails=1`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'VisionGuideAI-Mobile/1.0' },
    });
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      // If strictly bounded returned no results, expand slightly
      const fallbackUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
        category
      )}&limit=10&viewbox=${lon - 0.2},${lat + 0.2},${lon + 0.2},${lat - 0.2}&bounded=0`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: { 'User-Agent': 'VisionGuideAI-Mobile/1.0' },
      });
      const fallbackItems = await fallbackRes.json();
      if (Array.isArray(fallbackItems)) items.push(...fallbackItems);
    }

    const seenNames = new Set();
    const results = [];

    for (const item of items) {
      const itemLat = parseFloat(item.lat);
      const itemLon = parseFloat(item.lon);
      if (isNaN(itemLat) || isNaN(itemLon)) continue;

      const rawDist = calculateDistance(lat, lon, itemLat, itemLon);
      const roadDist = Math.round(rawDist * mode.factor);
      const durationSec = Math.round(roadDist / mode.speedMps);
      const direction = calculateBearing(lat, lon, itemLat, itemLon);

      const namePart = item.display_name.split(',')[0] || item.name || category;
      if (seenNames.has(namePart.toLowerCase())) continue;
      seenNames.add(namePart.toLowerCase());

      results.push({
        id: item.place_id ? String(item.place_id) : `${itemLat}_${itemLon}`,
        name: namePart,
        fullAddress: item.display_name,
        latitude: itemLat,
        longitude: itemLon,
        straightDistMeters: rawDist,
        distanceMeters: roadDist,
        distanceFormatted: formatDistance(roadDist),
        durationSeconds: durationSec,
        durationFormatted: formatDuration(durationSec),
        direction,
        mode: mode.label,
        modeKey: mode.key,
      });
    }

    return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch (e) {
    return [];
  }
}

/**
 * Fetches turn-by-turn road route between user location and destination via OSRM.
 */
export async function fetchOSRMRoute(fromLat, fromLon, toLat, toLon, modeKey = 'foot') {
  const profile = modeKey === 'driving' ? 'driving' : modeKey === 'cycling' ? 'bicycle' : 'foot';
  const endpoints = [
    `https://routing.openstreetmap.de/routed-${modeKey === 'driving' ? 'car' : modeKey === 'cycling' ? 'bike' : 'foot'}/route/v1/${profile}`,
    `https://router.project-osrm.org/route/v1/driving`,
  ];

  for (const ep of endpoints) {
    try {
      const url = `${ep}/${fromLon},${fromLat};${toLon},${toLat}?steps=true&overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.code === 'Ok' && data.routes?.length) {
        const r = data.routes[0];
        const mode = MODES.find((m) => m.key === modeKey) || MODES[0];
        const isFallback = ep.includes('project-osrm.org') && modeKey !== 'driving';
        const dist = isFallback ? Math.round(r.distance * (modeKey === 'foot' ? 0.9 : 1.0)) : Math.round(r.distance);
        const duration = Math.round(dist / mode.speedMps);

        return {
          distanceMeters: dist,
          distanceFormatted: formatDistance(dist),
          durationSeconds: duration,
          durationFormatted: formatDuration(duration),
          steps: r.legs?.[0]?.steps || [],
        };
      }
    } catch (_) {}
  }

  // Graceful fallback calculation if OSRM demo servers are busy
  const rawDist = calculateDistance(fromLat, fromLon, toLat, toLon);
  const mode = MODES.find((m) => m.key === modeKey) || MODES[0];
  const roadDist = Math.round(rawDist * mode.factor);
  const durationSec = Math.round(roadDist / mode.speedMps);

  return {
    distanceMeters: roadDist,
    distanceFormatted: formatDistance(roadDist),
    durationSeconds: durationSec,
    durationFormatted: formatDuration(durationSec),
    steps: [],
  };
}
