import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
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
  WALK_SPEED_MPS,
  CYCLE_SPEED_MPS,
} from "./routingService.js";

// Test coordinates: Chennai Central area
const ORIGIN = { lat: 13.0827, lon: 80.2707, label: "Chennai Central Station" };
const DESTINATION = { lat: 13.0878, lon: 80.2785, label: "Periamet" };

/* ── 1. ROUTING MODES CONFIGURATION ── */
test("Feature 1: Routing Modes & Zero-Key Endpoint Inspection", () => {
  assert.equal(ROUTING_MODES.length, 3, "Exactly 3 routing modes configured");
  const foot = ROUTING_MODES.find((m) => m.key === "foot");
  const bike = ROUTING_MODES.find((m) => m.key === "cycling");
  const car = ROUTING_MODES.find((m) => m.key === "driving");

  assert.ok(foot && bike && car, "All modes (foot, cycling, driving) are present");

  // Foot mode uses OSM Germany routed-foot as primary
  assert.match(foot.endpoints[0], /routed-foot/, "Foot mode uses routed-foot endpoint");
  // Bike mode uses routed-bike as primary
  assert.match(bike.endpoints[0], /routed-bike/, "Cycling mode uses routed-bike endpoint");

  // Zero-key requirement: no API keys or tokens in endpoints
  for (const mode of ROUTING_MODES) {
    for (const ep of mode.endpoints) {
      assert.ok(!ep.includes("api_key"), `Endpoint ${ep} must not require api_key`);
      assert.ok(!ep.includes("access_token"), `Endpoint ${ep} must not require access_token`);
    }
  }
});

/* ── 2. GPS ACCURACY TIERS & ADVISORIES ── */
test("Feature 2: GPS Accuracy Classification & User Advisories", () => {
  const pinPoint = classifyAccuracy(8);
  assert.equal(pinPoint.tier, "high");
  assert.equal(pinPoint.advisory, "");

  const moderate = classifyAccuracy(45);
  assert.equal(moderate.tier, "moderate");
  assert.match(moderate.advisory, /45 metres/);

  const weak = classifyAccuracy(180);
  assert.equal(weak.tier, "weak");
  assert.match(weak.advisory, /approximate.*180 metres/i);

  const unknown = classifyAccuracy(null);
  assert.equal(unknown.tier, "unknown");
});

/* ── 3. DYNAMIC OFF-ROUTE THRESHOLD (ANTI-JITTER) ── */
test("Feature 3: Dynamic Off-Route Threshold prevents false reroutes", () => {
  const baseThreshold = 80;

  // Good GPS (10m error): maintains base threshold 80m
  assert.equal(computeDynamicOffRouteThreshold(baseThreshold, 10), 80);

  // Moderate drift (60m error): scales threshold to 90m
  assert.equal(computeDynamicOffRouteThreshold(baseThreshold, 60), 90);

  // Severe drift (>150m): returns Infinity to suppress endless rerouting loop
  assert.equal(computeDynamicOffRouteThreshold(baseThreshold, 160), Infinity);
});

/* ── 4. ARRIVAL ELIGIBILITY ANTI-PREMATURE ARRIVAL ── */
test("Feature 4: Arrival Eligibility prevents false premature triggers", () => {
  const totalSteps = 6;
  const arrivalRadius = 25;

  // At step 0, even if physically 10m from destination (e.g. looped track), cannot trigger arrival
  assert.equal(checkArrivalEligibility(0, totalSteps, 10, arrivalRadius), false);
  // At step 2 (middle of route), cannot trigger arrival
  assert.equal(checkArrivalEligibility(2, totalSteps, 15, arrivalRadius), false);

  // At step 5 (final step), within arrival radius -> triggers arrival!
  assert.equal(checkArrivalEligibility(5, totalSteps, 18, arrivalRadius), true);

  // At step 5, but still 60m away -> does NOT trigger arrival
  assert.equal(checkArrivalEligibility(5, totalSteps, 60, arrivalRadius), false);
});

/* ── 5. TRAVEL DURATION & SPEECH ESTIMATION ── */
test("Feature 5: Travel Duration Estimation for Walk (1.4m/s) & Bike (4.2m/s)", () => {
  const distanceMeters = 2100; // 2.1 km

  // Walking: 2100 / 1.4 = 1500s (25 minutes)
  const walkEst = estimateTravelDuration("foot", distanceMeters, null);
  assert.equal(Math.round(walkEst.duration), 1500);
  assert.equal(walkEst.isEstimate, true);

  // Cycling: 2100 / 4.2 = 500s (~8.3 minutes)
  const bikeEst = estimateTravelDuration("cycling", distanceMeters, null);
  assert.equal(Math.round(bikeEst.duration), 500);
  assert.equal(bikeEst.isEstimate, true);

  // Driving: retains server-computed motor duration
  const carEst = estimateTravelDuration("driving", distanceMeters, 320);
  assert.equal(carEst.duration, 320);
  assert.equal(carEst.isEstimate, false);
});

/* ── 6. COORDINATE VALIDATION & NULL ISLAND REJECTION ── */
test("Feature 6: Coordinate Validation & Rejection of Null Island / Out of bounds", () => {
  assert.equal(isValidCoordinate(13.0827, 80.2707), true, "Valid Chennai coordinates");
  assert.equal(isValidCoordinate(0, 0), false, "Null Island (0,0) rejected");
  assert.equal(isValidCoordinate(-91, 50), false, "Latitude < -90 rejected");
  assert.equal(isValidCoordinate(92, 50), false, "Latitude > 90 rejected");
  assert.equal(isValidCoordinate(13, 190), false, "Longitude > 180 rejected");
  assert.equal(isValidCoordinate(null, 50), false, "Null latitude rejected");
  assert.equal(isValidCoordinate("13", "80"), false, "String inputs rejected");
});

/* ── 7. DISTANCE SPEECH ACCESSIBILITY FORMATTING ── */
test("Feature 7: Distance Speech Formatting for Screen Readers", () => {
  assert.equal(formatDistanceForSpeech(25), "just steps away");
  assert.equal(formatDistanceForSpeech(350), "350 metres away");
  assert.equal(formatDistanceForSpeech(1200), "1.2 kilometres away");
  assert.equal(formatDistanceForSpeech(5000), "5.0 kilometres away");
});

/* ── 8. ADDRESS & PLACE NAME SANITIZATION ── */
test("Feature 8: Address & Place Name Cleaning and Deduplication", () => {
  // Cleans redundant category tags from generic names
  const clean1 = cleanPlaceName("hospital", "hospital", "Apollo Speciality Hospital, Greams Road");
  assert.equal(clean1, "Apollo Speciality Hospital (Greams Road)");

  const clean2 = cleanPlaceName("State Bank ATM", "atm");
  assert.equal(clean2, "State Bank ATM");

  // Builds readable address from OpenStreetMap tags
  const tags = {
    "addr:housenumber": "42",
    "addr:street": "Anna Salai",
    "addr:city": "Chennai",
    "addr:postcode": "600002",
  };
  const addr = buildCleanAddress(tags);
  assert.equal(addr, "42 Anna Salai, Chennai, 600002");
});

/* ── 9. LIVE OSM ROUTE CALCULATION ACROSS ALL 3 MODES ── */
test("Feature 9: Live Route Calculation for Pedestrian, Cycling, and Driving", async () => {
  // Test Foot Mode
  const footUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${DESTINATION.lon},${DESTINATION.lat}?steps=true&overview=false`;
  const footRes = await fetch(footUrl);
  assert.equal(footRes.status, 200, "routed-foot returns 200 OK");
  const footData = await footRes.json();
  assert.equal(footData.code, "Ok", "routed-foot calculation successful");
  assert.ok(footData.routes[0].distance > 0, "foot route has valid distance");
  assert.ok(footData.routes[0].legs[0].steps.length >= 2, "foot route contains step maneuvers");

  // Test Bike Mode
  const bikeUrl = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${DESTINATION.lon},${DESTINATION.lat}?steps=true&overview=false`;
  const bikeRes = await fetch(bikeUrl);
  assert.equal(bikeRes.status, 200, "routed-bike returns 200 OK");
  const bikeData = await bikeRes.json();
  assert.equal(bikeData.code, "Ok", "routed-bike calculation successful");
  assert.ok(bikeData.routes[0].distance > 0, "bike route has valid distance");

  // Test Driving Mode
  const carUrl = `https://router.project-osrm.org/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${DESTINATION.lon},${DESTINATION.lat}?steps=true&overview=false`;
  const carRes = await fetch(carUrl);
  assert.equal(carRes.status, 200, "osrm driving returns 200 OK");
  const carData = await carRes.json();
  assert.equal(carData.code, "Ok", "car route calculation successful");
});

/* ── 10. NEARBY PLACES DISCOVERY ACROSS KEY ACCESSIBILITY CATEGORIES ── */
test("Feature 10: Nearby Places POI Discovery (Hospitals, ATMs, Pharmacies, Bus Stops)", async () => {
  const categoriesToTest = ["hospital", "pharmacy", "bus_stop"];

  for (const cat of categoriesToTest) {
    const places = await searchNearbyPlaces(cat, ORIGIN.lat, ORIGIN.lon, { timeoutMs: 6000 });
    assert.ok(Array.isArray(places), `Category ${cat} returns an array`);
    assert.ok(places.length > 0, `Category ${cat} found at least 1 place near test location`);
    const p = places[0];
    assert.ok(p.id, `${cat} place has unique id`);
    assert.ok(p.name, `${cat} place has name`);
    assert.ok(typeof p.lat === "number" && typeof p.lon === "number", `${cat} has valid coordinates`);
    assert.ok(p.distM >= 0, `${cat} has positive distance`);
    assert.ok(p.formattedDist, `${cat} has speech distance formatted`);
  }
});

/* ── 11. NEAREST-FIRST SORTING GUARANTEE ── */
test("Feature 11: POIs strictly sorted nearest-first (ascending distance)", async () => {
  const places = await searchNearbyPlaces("atm", ORIGIN.lat, ORIGIN.lon);
  assert.ok(places.length >= 2, "Returned at least 2 places to verify sorting order");

  for (let i = 0; i < places.length - 1; i++) {
    assert.ok(
      places[i].distM <= places[i + 1].distM,
      `Places must be sorted nearest first: index ${i} (${places[i].distM}m) <= index ${i + 1} (${places[i + 1].distM}m)`
    );
  }
  // Closest place should be within 1.5 km of city center
  assert.ok(places[0].distM < 1500, `Closest POI is within walking distance (${places[0].distM}m)`);
});

/* ── 12. TURN-BY-TURN STEP SIMULATION & PROGRESSION (VIRTUAL WALKER) ── */
test("Feature 12: Turn-by-Turn GPS Step Progression & Destination Arrival Simulation", async () => {
  // Fetch real steps from foot routing
  const footUrl = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${DESTINATION.lon},${DESTINATION.lat}?steps=true&overview=false`;
  const res = await fetch(footUrl);
  const data = await res.json();
  const rawSteps = data.routes[0].legs[0].steps;

  // Build steps exactly like NavigationPage.jsx
  const steps = rawSteps.map((s, idx) => {
    const loc = s.maneuver?.location;
    return {
      id: idx,
      instruction: s.maneuver?.instruction || "Continue straight",
      type: s.maneuver?.type,
      modifier: s.maneuver?.modifier,
      name: s.name || "",
      distM: Math.round(s.distance || 0),
      wpLat: loc ? loc[1] : null,
      wpLon: loc ? loc[0] : null,
    };
  });

  assert.ok(steps.length >= 2, "Route has multiple steps to simulate");

  const thresholds = {
    announceDist: 50,
    finalDist: 15,
    completeDist: 20,
    arrivalDist: 25,
  };

  let currentStepIdx = 0;
  const stepStates = steps.map(() => "pending");
  let navStatus = "active";
  const speechEvents = [];

  const simulateGpsUpdate = (lat, lon, accuracy = 10) => {
    // 1. Check Arrival
    const arrivalDist = haversineM(lat, lon, DESTINATION.lat, DESTINATION.lon);
    if (checkArrivalEligibility(currentStepIdx, steps.length, arrivalDist, thresholds.arrivalDist)) {
      navStatus = "arrived";
      speechEvents.push("You have arrived at your destination!");
      return;
    }

    const step = steps[currentStepIdx];
    if (!step) return;

    const distToWp = step.wpLat != null ? haversineM(lat, lon, step.wpLat, step.wpLon) : null;

    // 2. Complete Step
    if (distToWp !== null && distToWp < thresholds.completeDist && step.type !== "arrive") {
      stepStates[currentStepIdx] = "completed";
      currentStepIdx = Math.min(currentStepIdx + 1, steps.length - 1);
      speechEvents.push(`Step completed -> Advanced to Step ${currentStepIdx}`);
      return;
    }

    // 3. Proximity Announcements
    if (distToWp !== null && step.type !== "depart" && step.type !== "arrive") {
      if (stepStates[currentStepIdx] === "pending" && distToWp <= thresholds.announceDist) {
        stepStates[currentStepIdx] = "announced";
        speechEvents.push(`Approaching turn: ${step.instruction} in ${Math.round(distToWp)}m`);
      } else if (stepStates[currentStepIdx] === "announced" && distToWp <= thresholds.finalDist) {
        stepStates[currentStepIdx] = "final";
        speechEvents.push(`Turn now: ${step.instruction}`);
      }
    }
  };

  // Walker starts at origin
  simulateGpsUpdate(ORIGIN.lat, ORIGIN.lon);
  assert.ok(currentStepIdx >= 0, "Walker initialized cleanly");

  // Walker walks and passes through all steps to destination
  for (let s = 0; s < steps.length - 1; s++) {
    const step = steps[s];
    if (step.wpLat && step.wpLon) {
      // Approach waypoint
      simulateGpsUpdate(step.wpLat + 0.0003, step.wpLon + 0.0003); // ~40m away
      // Reach waypoint
      simulateGpsUpdate(step.wpLat, step.wpLon); // 0m away
    }
  }

  // Walker reaches Destination
  simulateGpsUpdate(DESTINATION.lat, DESTINATION.lon);

  assert.equal(navStatus, "arrived", "Navigation transitioned to arrived state");
  assert.ok(
    speechEvents.some((ev) => ev.includes("You have arrived")),
    "Arrival speech event triggered"
  );
});

/* ── 13. VOICE COMMAND INTENT ROUTING ── */
test("Feature 13: Voice Command Intent Parsing for Visually Impaired Users", () => {
  const parseVoiceIntent = (rawTranscript) => {
    const t = rawTranscript.trim().toLowerCase();
    if (/^stop( navigation)?$/.test(t)) return { action: "stop" };
    if (/^clear( navigation| route)?$/.test(t)) return { action: "clear" };
    if (/^(repeat|repeat step|where do i go|what is next|next step|where am i)$/.test(t)) return { action: "repeat" };
    if (/^(start|start navigation|begin navigation|start gps)$/.test(t)) return { action: "start" };
    if (/^(use |switch to |mode )?(walk|walking|pedestrian|foot)$/.test(t)) return { action: "mode", mode: "foot" };
    if (/^(use |switch to |mode )?(bike|bicycle|cycling)$/.test(t)) return { action: "mode", mode: "cycling" };
    if (/^(use |switch to |mode )?(car|drive|driving)$/.test(t)) return { action: "mode", mode: "driving" };
    const nearestMatch = t.match(/^(?:navigate to |take me to |go to )?(?:the )?nearest (.+)$/);
    if (nearestMatch) return { action: "nearest", query: `${nearestMatch[1]} near me` };
    const cleanDest = rawTranscript.replace(/^(navigate to|take me to|go to|directions to|route to)\s+/i, "").trim();
    if (cleanDest) return { action: "destination", destination: cleanDest };
    return { action: "unknown" };
  };

  assert.deepEqual(parseVoiceIntent("stop navigation"), { action: "stop" });
  assert.deepEqual(parseVoiceIntent("clear route"), { action: "clear" });
  assert.deepEqual(parseVoiceIntent("where am i"), { action: "repeat" });
  assert.deepEqual(parseVoiceIntent("start navigation"), { action: "start" });
  assert.deepEqual(parseVoiceIntent("switch to bike"), { action: "mode", mode: "cycling" });
  assert.deepEqual(parseVoiceIntent("walk"), { action: "mode", mode: "foot" });
  assert.deepEqual(parseVoiceIntent("drive"), { action: "mode", mode: "driving" });
  assert.deepEqual(parseVoiceIntent("navigate to the nearest hospital"), { action: "nearest", query: "hospital near me" });
  assert.deepEqual(parseVoiceIntent("directions to Central Station"), { action: "destination", destination: "Central Station" });
});
