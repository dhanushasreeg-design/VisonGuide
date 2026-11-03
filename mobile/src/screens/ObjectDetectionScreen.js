import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAccessibility } from '../context/AccessibilityContext';
import { analyzeImageForObstacles, ACCESSIBILITY_CLASSES } from '../services/detectionService';
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function ObjectDetectionScreen({ onBack }) {
  const { speak, triggerHaptic } = useAccessibility();
  const [imageUri, setImageUri] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [detectionData, setDetectionData] = useState(null);

  const takePhoto = async () => {
    triggerHaptic('medium');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      speak('Camera permission denied.');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!res.canceled && res.assets && res.assets.length > 0) {
      processPhoto(res.assets[0].uri);
    }
  };

  const pickImage = async () => {
    triggerHaptic('light');
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });

    if (!res.canceled && res.assets && res.assets.length > 0) {
      processPhoto(res.assets[0].uri);
    }
  };

  const processPhoto = async (uri) => {
    setImageUri(uri);
    setAnalyzing(true);
    speak('Analyzing captured photo for obstacles and hazards.');

    try {
      const results = await analyzeImageForObstacles(uri);
      setDetectionData(results);
      if (results.hazardWarnings.length > 0) {
        speak(`Hazard alert! ${results.hazardWarnings[0]}`);
      } else {
        speak(`Analysis complete. ${results.speechSummary}`);
      }
    } catch (_) {
      speak('Could not complete detection analysis.');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Header title="Object Detection" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Action Buttons */}
        <View style={styles.btnRow}>
          <BigButton
            title="Open Camera"
            icon="📷"
            variant="green"
            style={{ flex: 1 }}
            onPress={takePhoto}
          />
          <BigButton
            title="Upload Photo"
            icon="🖼️"
            variant="ghost"
            style={{ flex: 1 }}
            onPress={pickImage}
          />
        </View>

        {/* Image Preview & Scanner */}
        {imageUri ? (
          <View style={styles.previewCard}>
            <Image source={{ uri: imageUri }} style={styles.image} resizeMode="cover" />
            {analyzing && (
              <View style={styles.scannerOverlay}>
                <ActivityIndicator size="large" color="#22c55e" />
                <Text style={styles.analyzingText}>Running DETR Hazard Classifier…</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.placeholderCard}>
            <Text style={styles.placeholderIcon}>🔍</Text>
            <Text style={styles.placeholderTitle}>Scan Obstacles & Hazards</Text>
            <Text style={styles.placeholderDesc}>
              Point your camera at a walkway or room. Detects potholes, stairs, wheelchairs, pedestrians, and vehicles.
            </Text>
          </View>
        )}

        {/* Detection Results */}
        {detectionData && (
          <View style={styles.resultsCard}>
            <Text style={styles.resultsHeader}>
              Detected Objects ({detectionData.totalCount})
            </Text>

            {detectionData.items.map((item) => (
              <View
                key={item.id}
                style={[
                  styles.itemRow,
                  item.isHazard && styles.hazardRow,
                ]}
              >
                <View style={styles.itemLeft}>
                  <Text style={styles.itemEmoji}>{item.isHazard ? '⚠️' : '🎯'}</Text>
                  <View>
                    <Text style={[styles.itemLabel, item.isHazard && { color: '#f87171' }]}>
                      {item.label}
                    </Text>
                    <Text style={styles.itemDistance}>📍 {item.distanceApprox}</Text>
                  </View>
                </View>

                <View style={styles.confBadge}>
                  <Text style={styles.confText}>{Math.round(item.confidence * 100)}%</Text>
                </View>
              </View>
            ))}

            <BigButton
              title="Speak Detection Summary Again"
              icon="🔊"
              variant="yellow"
              style={{ marginTop: 14 }}
              onPress={() => speak(detectionData.speechSummary)}
            />
          </View>
        )}

        {/* Hazard Class Reference Legend */}
        <Text style={styles.legendTitle}>Accessibility Hazard Library</Text>
        <View style={styles.legendGrid}>
          {ACCESSIBILITY_CLASSES.map((c) => (
            <View key={c.name} style={styles.legendItem}>
              <Text style={styles.legendIcon}>{c.icon}</Text>
              <Text style={styles.legendName}>{c.name}</Text>
            </View>
          ))}
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
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  previewCard: {
    borderRadius: 16,
    overflow: 'hidden',
    height: 240,
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    position: 'relative',
    marginBottom: 16,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,8,15,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  analyzingText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
  },
  placeholderCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 30,
    alignItems: 'center',
    marginBottom: 20,
  },
  placeholderIcon: {
    fontSize: 48,
    marginBottom: 10,
  },
  placeholderTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  placeholderDesc: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  resultsCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  resultsHeader: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  hazardRow: {
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderRadius: 10,
    paddingHorizontal: 10,
    marginVertical: 4,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  itemEmoji: {
    fontSize: 20,
  },
  itemLabel: {
    color: '#f9fafb',
    fontSize: 14,
    fontWeight: '700',
  },
  itemDistance: {
    color: '#9ca3af',
    fontSize: 12,
  },
  confBadge: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  confText: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '800',
  },
  legendTitle: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  legendItem: {
    backgroundColor: '#0d1117',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendIcon: {
    fontSize: 16,
  },
  legendName: {
    color: '#d1d5db',
    fontSize: 12,
    fontWeight: '600',
  },
});
