import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTING_MODES,
  classifyAccuracy,
  computeDynamicOffRouteThreshold,
  checkArrivalEligibility,
  estimateTravelDuration,
  isValidCoordinate,
  formatDistanceForSpeech,
  buildCleanAddress,
  cleanPlaceName,
  searchNearbyPlaces,
  haversineM,
  haversineKm,
} from "./routingService.js";

test("ROUTING_MODES configuration", (t) => {
  assert.equal(ROUTING_MODES.length, 3);
  const foot = ROUTING_MODES.find(m => m.key === "foot");
  const bike = ROUTING_MODES.find(m => m.key === "cycling");
  const car = ROUTING_MODES.find(m => m.key === "driving");

  assert.ok(foot, "foot mode exists");
  assert.ok(bike, "bike mode exists");
  assert.ok(car, "car mode exists");

  // Zero API keys check
  for (const mode of ROUTING_MODES) {
    for (const ep of mode.endpoints) {
      assert.ok(!ep.includes("key="), `Endpoint ${ep} must not require api keys`);
      assert.ok(!ep.includes("token="), `Endpoint ${ep} must not require tokens`);
    }
  }

  // Primary foot endpoint must be OpenStreetMap Germany's routed-foot
  assert.match(foot.endpoints[0], /routed-foot/);
  // Primary bike endpoint must be routed-bike
  assert.match(bike.endpoints[0], /routed-bike/);
});

test("classifyAccuracy - tiers and advisories", () => {
  const high = classifyAccuracy(12);
  assert.equal(high.tier, "high");
  assert.equal(high.advisory, "");

  const mod = classifyAccuracy(50);
  assert.equal(mod.tier, "moderate");
  assert.match(mod.advisory, /50 metres/);

  const weak = classifyAccuracy(250);
  assert.equal(weak.tier, "weak");
  assert.match(weak.advisory, /approximate.*250 metres/i);

  const unknown = classifyAccuracy(null);
  assert.equal(unknown.tier, "unknown");
});

test("computeDynamicOffRouteThreshold - prevents false rerouting", () => {
  // Pinpoint GPS (5m error) uses base 80m
  assert.equal(computeDynamicOffRouteThreshold(80, 5), 80);

  // Moderate GPS (60m error) scales threshold to 90m
  assert.equal(computeDynamicOffRouteThreshold(80, 60), 90);

  // Very weak GPS (180m error) returns Infinity to prevent loops
  assert.equal(computeDynamicOffRouteThreshold(80, 180), Infinity);
});

test("checkArrivalEligibility - prevents premature arrival triggers", () => {
  const totalSteps = 8;
  
  // Early in the route (step 0 or 1), user passes near end of route by mistake
  assert.equal(checkArrivalEligibility(0, totalSteps, 20, 30), false);
  assert.equal(checkArrivalEligibility(2, totalSteps, 15, 30), false);

  // Near the end of route (step 6 or 7)
  assert.equal(checkArrivalEligibility(6, totalSteps, 25, 30), true);
  assert.equal(checkArrivalEligibility(7, totalSteps, 10, 30), true);

  // Outside arrival radius
  assert.equal(checkArrivalEligibility(7, totalSteps, 45, 30), false);

  // Short route (2 steps)
  assert.equal(checkArrivalEligibility(0, 2, 20, 30), true);
});

test("estimateTravelDuration - honest walk and cycle times", () => {
  const dist = 1400; // 1.4 km
  
  // Walk: 1400m / 1.4 m/s = 1000s
  const walkEst = estimateTravelDuration("foot", dist, null);
  assert.equal(Math.round(walkEst.duration), 1000);
  assert.equal(walkEst.isEstimate, true);

  // Bike: 1400m / 4.2 m/s = 333s
  const bikeEst = estimateTravelDuration("cycling", dist, null);
  assert.equal(Math.round(bikeEst.duration), 333);
  assert.equal(bikeEst.isEstimate, true);

  // Car: preserves engine duration
  const carEst = estimateTravelDuration("driving", dist, 180);
  assert.equal(carEst.duration, 180);
  assert.equal(carEst.isEstimate, false);
});

test("isValidCoordinate - validation", () => {
  assert.equal(isValidCoordinate(13.0827, 80.2707), true);
  assert.equal(isValidCoordinate(-91, 50), false);
  assert.equal(isValidCoordinate(10, 195), false);
  assert.equal(isValidCoordinate(0, 0), false); // Null Island rejection
  assert.equal(isValidCoordinate(NaN, 50), false);
  assert.equal(isValidCoordinate("13", "80"), false);
});

test("formatDistanceForSpeech - accessibility friendly", () => {
  assert.equal(formatDistanceForSpeech(30), "just steps away");
  assert.equal(formatDistanceForSpeech(450), "450 metres away");
  assert.equal(formatDistanceForSpeech(1800), "1.8 kilometres away");
});

test("buildCleanAddress - formats Nominatim and OSM tags", () => {
  const nom = { road: "Poonamallee High Rd", suburb: "Kilpauk", city: "Chennai", postcode: "600010" };
  assert.equal(buildCleanAddress(nom), "Poonamallee High Rd, Kilpauk, Chennai, 600010");

  const osm = { "addr:housenumber": "10", "addr:street": "North St", "addr:city": "Madurai" };
  assert.equal(buildCleanAddress(osm), "10 North St, Madurai");
});

test("cleanPlaceName - eliminates generic text", () => {
  assert.equal(cleanPlaceName("Apollo Pharmacy", "pharmacy"), "Apollo Pharmacy");
  assert.equal(cleanPlaceName("hospital", "hospital", "City Care Hospital, Anna Nagar, Chennai"), "City Care Hospital (Anna Nagar)");
  assert.equal(cleanPlaceName("", "atm"), "Atm");
});

test("Live OSM routed-foot pedestrian query works without any API keys", async () => {
  const fromLon = 80.2707, fromLat = 13.0827;
  const toLon = 80.2785, toLat = 13.0878;
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${fromLon},${fromLat};${toLon},${toLat}?steps=true&overview=false`;

  const res = await fetch(url);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.code, "Ok");
  assert.ok(data.routes && data.routes.length > 0);
  assert.ok(data.routes[0].distance > 0);
  assert.ok(data.routes[0].legs[0].steps.length > 0);
});

test("searchNearbyPlaces - live OSM lookup without API keys", async () => {
  const lat = 13.0827, lon = 80.2707;
  const places = await searchNearbyPlaces("hospital", lat, lon, { radiusKm: 8 });
  assert.ok(Array.isArray(places), "returns an array of places");
  assert.ok(places.length > 0, "found at least one nearby hospital");
  const first = places[0];
  assert.ok(first.name, "has place name");
  assert.ok(first.distM >= 0, "has valid distance");
  assert.ok(first.formattedDist, "has speech-ready distance");
});
