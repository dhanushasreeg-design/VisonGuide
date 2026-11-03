import * as Location from 'expo-location';

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
  return Math.round(R * c); // Distance in meters
}

export function formatDistance(meters) {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)} km`;
  }
  return `${meters} m`;
}

export async function getCurrentGPSPosition() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission denied. Please allow GPS access in settings.');
  }

  const loc = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    speed: loc.coords.speed || 0,
    heading: loc.coords.heading || 0,
  };
}

export async function getCleanAddress(lat, lon) {
  try {
    const res = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
    if (res && res.length > 0) {
      const p = res[0];
      return [p.name, p.street, p.district, p.city].filter(Boolean).join(', ');
    }
  } catch (_) {}
  return `Lat: ${lat.toFixed(4)}, Lon: ${lon.toFixed(4)}`;
}

export async function fetchNearbyPlaces(category, lat, lon) {
  // Query OpenStreetMap Nominatim for real local POIs
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(category)}&limit=10&viewbox=${lon - 0.05},${lat + 0.05},${lon + 0.05},${lat - 0.05}&bounded=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'VisionGuideAI-Mobile/1.0' },
    });
    const items = await res.json();
    return items.map((item) => {
      const itemLat = parseFloat(item.lat);
      const itemLon = parseFloat(item.lon);
      const dist = calculateDistance(lat, lon, itemLat, itemLon);
      return {
        id: item.place_id,
        name: item.display_name.split(',')[0] || item.name || category,
        fullAddress: item.display_name,
        latitude: itemLat,
        longitude: itemLon,
        distanceMeters: dist,
        distanceFormatted: formatDistance(dist),
      };
    }).sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch (e) {
    return [];
  }
}
