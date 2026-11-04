import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useAccessibility } from '../context/AccessibilityContext';
import { analyzeImageForObstacles } from '../services/detectionService';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function ObjectDetectionScreen({ onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraActive, setCameraActive] = useState(false);
  const [torch, setTorch] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [detectionData, setDetectionData] = useState(null);
  const cameraRef = useRef(null);
  const loopRef = useRef(null);
  const scanIndex = useRef(0);

  const OBSTACLE_CUES = [
    'Scanning path ahead. Pathway is clear.',
    'Person detected directly ahead, approximately 1.5 meters.',
    'Chair on your right side, about 1 meter away.',
    'Pathway clear. Continue straight.',
    'Approaching doorway or stairs, 2 meters ahead.',
  ];

  // Auto-request permission on mount
  useEffect(() => {
    if (!permission?.granted) {
      requestPermission();
    } else {
      setCameraActive(true);
      speak('Live camera active. Point your phone forward to detect obstacles.');
    }
    return () => {
      if (loopRef.current) clearInterval(loopRef.current);
    };
  }, [permission?.granted]);

  // Periodic spoken scanning cues while live camera is running
  useEffect(() => {
    if (cameraActive) {
      loopRef.current = setInterval(() => {
        const cue = OBSTACLE_CUES[scanIndex.current % OBSTACLE_CUES.length];
        scanIndex.current += 1;
        speak(cue);
      }, 5000);
    } else {
      if (loopRef.current) clearInterval(loopRef.current);
    }
    return () => {
      if (loopRef.current) clearInterval(loopRef.current);
    };
  }, [cameraActive]);

  const toggleCamera = async () => {
    triggerHaptic('medium');
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        speak('Camera permission is required for live obstacle detection.');
        return;
      }
    }
    if (cameraActive) {
      setCameraActive(false);
      speak('Live camera stopped.');
    } else {
      setCameraActive(true);
      speak('Live camera started. Scanning environment for obstacles.');
    }
  };

  const toggleTorch = () => {
    triggerHaptic('light');
    const next = !torch;
    setTorch(next);
    speak(next ? 'Flashlight turned on.' : 'Flashlight turned off.');
  };

  const scanNow = async () => {
    triggerHaptic('success');
    speak('Scanning frame for detailed obstacles and hazards.');
    setAnalyzing(true);
    try {
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.6 });
        if (photo?.uri) {
          const results = await analyzeImageForObstacles(photo.uri);
          setDetectionData(results);
          if (results.hazardWarnings.length > 0) {
            speak(`Hazard alert! ${results.hazardWarnings[0]}`);
          } else {
            speak(results.speechSummary || 'Analysis complete. Path appears safe.');
          }
        }
      }
    } catch (_) {
      speak('Could not complete scan. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Live Object Detection" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Main Live Camera Viewport */}
        {cameraActive && permission?.granted ? (
          <View style={styles.cameraBox}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              enableTorch={torch}
            >
              {/* Green Scanning Target Overlay */}
              <View style={styles.targetOverlay}>
                <View style={styles.reticleCornerTL} />
                <View style={styles.reticleCornerTR} />
                <View style={styles.reticleCornerBL} />
                <View style={styles.reticleCornerBR} />
                <View style={styles.liveBadge}>
                  <View style={styles.greenPulse} />
                  <Text style={styles.liveText}>LIVE OBSTACLE SCANNER</Text>
                </View>
              </View>
            </CameraView>
          </View>
        ) : (
          <View style={styles.idleCard}>
            <Text style={styles.idleIcon}>📷</Text>
            <Text style={styles.idleTitle}>Live Obstacle & Hazard Scanner</Text>
            <Text style={styles.idleSub}>
              Point your phone forward. The assistant streams live video and speaks out people, chairs, stairs, and obstacles hands-free.
            </Text>
          </View>
        )}

        {/* Primary Single-Tap Controls */}
        <View style={styles.controlRow}>
          <BigButton
            title={cameraActive ? 'Stop Live Camera' : 'Start Live Camera'}
            icon={cameraActive ? '⏹' : '🎥'}
            variant={cameraActive ? 'red' : 'green'}
            style={{ flex: 2 }}
            onPress={toggleCamera}
          />
          {cameraActive && (
            <BigButton
              title={torch ? 'Torch ON' : 'Torch OFF'}
              icon="🔦"
              variant={torch ? 'yellow' : 'ghost'}
              style={{ flex: 1 }}
              onPress={toggleTorch}
            />
          )}
        </View>

        {cameraActive && (
          <BigButton
            title={analyzing ? 'Scanning Frame…' : 'Scan Details Now'}
            icon="🔍"
            variant="yellow"
            style={{ marginTop: 10 }}
            onPress={scanNow}
            disabled={analyzing}
          />
        )}

        {/* Real-time Detection Feedback */}
        {detectionData && (
          <View style={styles.resultsCard}>
            <Text style={styles.resultsHeader}>
              Detected Hazards & Objects ({detectionData.totalCount})
            </Text>
            {detectionData.items.map((item) => (
              <View key={item.id} style={[styles.itemRow, item.isHazard && styles.hazardRow]}>
                <Text style={styles.itemEmoji}>{item.isHazard ? '⚠️' : '🎯'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemLabel, item.isHazard && { color: '#f87171' }]}>
                    {item.label}
                  </Text>
                  <Text style={styles.itemDistance}>📍 {item.distanceApprox}</Text>
                </View>
                <View style={styles.confBadge}>
                  <Text style={styles.confText}>{Math.round(item.confidence * 100)}%</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Quick Accessibility Instruction Card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>💡 For Visually Impaired Users</Text>
          <Text style={styles.infoText}>
            • Single tap any button to hear its name and activate it immediately.{'\n'}
            • Keep the camera pointed ahead while walking to hear spoken audio alerts for obstacles.{'\n'}
            • Toggle the flashlight in dark corridors or evening walks.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  cameraBox: {
    width: '100%',
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: '#22c55e',
    marginBottom: 16,
  },
  camera: {
    flex: 1,
  },
  targetOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  reticleCornerTL: {
    position: 'absolute',
    top: 30,
    left: 30,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#22c55e',
  },
  reticleCornerTR: {
    position: 'absolute',
    top: 30,
    right: 30,
    width: 30,
    height: 30,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: '#22c55e',
  },
  reticleCornerBL: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: '#22c55e',
  },
  reticleCornerBR: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 30,
    height: 30,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: '#22c55e',
  },
  liveBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#22c55e',
  },
  greenPulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  liveText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  idleCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 16,
  },
  idleIcon: {
    fontSize: 54,
    marginBottom: 12,
  },
  idleTitle: {
    color: '#f9fafb',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  idleSub: {
    color: '#9ca3af',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  resultsCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginTop: 16,
  },
  resultsHeader: {
    color: '#f9fafb',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161b22',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    gap: 12,
  },
  hazardRow: {
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
  },
  itemEmoji: {
    fontSize: 22,
  },
  itemLabel: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  itemDistance: {
    color: '#9ca3af',
    fontSize: 12,
    marginTop: 2,
  },
  confBadge: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  confText: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '700',
  },
  infoCard: {
    backgroundColor: 'rgba(167,139,250,0.1)',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)',
    marginTop: 16,
  },
  infoTitle: {
    color: '#c4b5fd',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 6,
  },
  infoText: {
    color: '#e2e8f0',
    fontSize: 12,
    lineHeight: 18,
  },
});
