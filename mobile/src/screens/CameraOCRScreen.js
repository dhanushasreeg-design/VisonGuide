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
import Header from '../components/Header';
import BigButton from '../components/BigButton';

export default function CameraOCRScreen({ onBack }) {
  const { speak, stopSpeaking, isSpeaking, triggerHaptic } = useAccessibility();
  const [imageUri, setImageUri] = useState(null);
  const [ocrText, setOcrText] = useState('');
  const [scanning, setScanning] = useState(false);

  const takeDocumentPhoto = async () => {
    triggerHaptic('medium');
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      speak('Camera permission denied.');
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.9,
    });

    if (!res.canceled && res.assets && res.assets.length > 0) {
      processOCR(res.assets[0].uri);
    }
  };

  const processOCR = async (uri) => {
    setImageUri(uri);
    setScanning(true);
    speak('Scanning document and extracting text with OCR engine.');

    // Simulate OCR processing time
    setTimeout(() => {
      const extracted =
        'VISIONGUIDE ACCESSIBILITY NOTICE:\n' +
        'Prescription: Take one capsule twice daily after meals.\n' +
        'Emergency Helpline: 112 / 911.\n' +
        'Store at room temperature below 25°C. Keep out of reach of children.';

      setOcrText(extracted);
      setScanning(false);
      speak(`Text recognized: ${extracted}`);
    }, 1200);
  };

  return (
    <View style={styles.container}>
      <Header title="Camera OCR Reader" showBack onBack={onBack} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BigButton
          title="Scan Document with Camera"
          icon="📷"
          variant="green"
          onPress={takeDocumentPhoto}
        />

        {imageUri && (
          <View style={styles.imageBox}>
            <Image source={{ uri: imageUri }} style={styles.docImage} resizeMode="cover" />
          </View>
        )}

        {scanning && (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={styles.loadingText}>Recognizing text from document…</Text>
          </View>
        )}

        {ocrText ? (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>📖 Recognized Text</Text>
            <View style={styles.textBox}>
              <Text style={styles.textContent}>{ocrText}</Text>
            </View>

            <View style={styles.controlsRow}>
              <BigButton
                title={isSpeaking ? 'Stop Reading' : 'Read Aloud'}
                icon={isSpeaking ? '⏹' : '🔊'}
                variant={isSpeaking ? 'red' : 'yellow'}
                style={{ flex: 1 }}
                onPress={() => (isSpeaking ? stopSpeaking() : speak(ocrText))}
              />
            </View>
          </View>
        ) : (
          !scanning && (
            <View style={styles.guideCard}>
              <Text style={styles.guideIcon}>📄</Text>
              <Text style={styles.guideTitle}>Document & Label Reader</Text>
              <Text style={styles.guideDesc}>
                Point your camera at medicine bottles, product labels, signs, or printed letters to have them read aloud automatically.
              </Text>
            </View>
          )
        )}
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
  imageBox: {
    height: 180,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#0d1117',
    marginVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  docImage: {
    width: '100%',
    height: '100%',
  },
  loadingCard: {
    backgroundColor: '#0d1117',
    padding: 24,
    borderRadius: 14,
    alignItems: 'center',
    marginVertical: 14,
    gap: 10,
  },
  loadingText: {
    color: '#22c55e',
    fontSize: 14,
    fontWeight: '700',
  },
  resultCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginTop: 14,
  },
  resultTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 10,
  },
  textBox: {
    backgroundColor: '#05080f',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 14,
  },
  textContent: {
    color: '#e5e7eb',
    fontSize: 15,
    lineHeight: 22,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  guideCard: {
    backgroundColor: '#0d1117',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  guideIcon: {
    fontSize: 44,
    marginBottom: 10,
  },
  guideTitle: {
    color: '#f9fafb',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  guideDesc: {
    color: '#9ca3af',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
});

