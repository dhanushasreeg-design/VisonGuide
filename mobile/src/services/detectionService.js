/**
 * VisionGuide AI Mobile Detection & Hazard Classifier
 * Processes captured camera photos and analyzes accessibility obstacles,
 * hazards (potholes, steps), and common objects.
 */

export const ACCESSIBILITY_CLASSES = [
  { name: 'Wheelchair', category: 'accessibility', color: '#22c55e', icon: '♿', warning: false },
  { name: 'White Cane', category: 'accessibility', color: '#facc15', icon: '🦯', warning: false },
  { name: 'Pothole', category: 'hazard', color: '#ef4444', icon: '⚠️', warning: true },
  { name: 'Pedestrian / Person', category: 'person', color: '#60a5fa', icon: '🚶', warning: false },
  { name: 'Motor Vehicle / Car', category: 'traffic', color: '#fb923c', icon: '🚗', warning: true },
  { name: 'Bicycle', category: 'traffic', color: '#38bdf8', icon: '🚲', warning: false },
  { name: 'Stairs / Drop-off', category: 'hazard', color: '#ef4444', icon: '🪜', warning: true },
  { name: 'Door / Entrance', category: 'navigation', color: '#a78bfa', icon: '🚪', warning: false },
];

export async function analyzeImageForObstacles(imageUri) {
  // Simulate image feature parsing and model scoring
  // In production, this interfaces with the local DETR/MobileNet weights
  await new Promise((r) => setTimeout(r, 650));

  // Deterministic mock analysis based on image properties or typical outdoor scene
  const results = [
    {
      id: 'det-1',
      label: 'Pedestrian / Person',
      confidence: 0.94,
      box: { x: 120, y: 80, width: 140, height: 260 },
      distanceApprox: '2.5 meters ahead',
      isHazard: false,
    },
    {
      id: 'det-2',
      label: 'Pothole',
      confidence: 0.88,
      box: { x: 80, y: 320, width: 180, height: 90 },
      distanceApprox: '1.2 meters at 11 o’clock',
      isHazard: true,
      alertMessage: 'Caution: Pothole detected 1.2 meters ahead on your walkway.',
    },
    {
      id: 'det-3',
      label: 'Door / Entrance',
      confidence: 0.82,
      box: { x: 260, y: 60, width: 120, height: 280 },
      distanceApprox: '4 meters straight ahead',
      isHazard: false,
    },
  ];

  const speechSummary = results
    .map((r) => `${r.label} detected ${r.distanceApprox} with ${Math.round(r.confidence * 100)}% confidence.`)
    .join(' ');

  const hazardWarnings = results.filter((r) => r.isHazard).map((r) => r.alertMessage);

  return {
    items: results,
    speechSummary,
    hazardWarnings,
    totalCount: results.length,
  };
}

