import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  StatusBar,
  Linking,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

// Context Providers for Native Mode
import { AuthProvider } from './src/context/AuthContext';
import { AccessibilityProvider } from './src/context/AccessibilityContext';

// Components & Screens for Native Fallback
import BottomNav from './src/components/BottomNav';
import DashboardScreen from './src/screens/DashboardScreen';
import VoiceAssistantScreen from './src/screens/VoiceAssistantScreen';
import NavigationScreen from './src/screens/NavigationScreen';
import SOSAlertScreen from './src/screens/SOSAlertScreen';
import ObjectDetectionScreen from './src/screens/ObjectDetectionScreen';
import CameraOCRScreen from './src/screens/CameraOCRScreen';
import EmergencyContactsScreen from './src/screens/EmergencyContactsScreen';
import SavedLocationsScreen from './src/screens/SavedLocationsScreen';
import ArticleReaderScreen from './src/screens/ArticleReaderScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import MoreMenuScreen from './src/screens/MoreMenuScreen';

const CLOUD_URL = 'https://dhanushasreeg-design.github.io/VisonGuide/';
const LOCAL_URL = 'http://192.168.1.9:3000/';

function NativeNavigator({ onSwitchToWeb }) {
  const [currentScreen, setCurrentScreen] = useState('Dashboard');
  const [screenParams, setScreenParams] = useState({});
  const [history, setHistory] = useState(['Dashboard']);

  const navigateTo = (screenName, params = {}) => {
    setScreenParams(params);
    setCurrentScreen(screenName);
    setHistory((prev) => [...prev, screenName]);
  };

  const goBack = () => {
    if (history.length > 1) {
      const nextHistory = [...history];
      nextHistory.pop();
      const prevScreen = nextHistory[nextHistory.length - 1];
      setHistory(nextHistory);
      setCurrentScreen(prevScreen);
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (Platform.OS === 'android') {
      const onBackPress = () => goBack();
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }
  }, [history]);

  const renderActiveScreen = () => {
    switch (currentScreen) {
      case 'VoiceAssistant':
        return <VoiceAssistantScreen onNavigate={navigateTo} onBack={goBack} />;
      case 'Navigation':
        return <NavigationScreen initialQuery={screenParams.query || 'hospital'} onBack={goBack} />;
      case 'SOSAlert':
        return <SOSAlertScreen onBack={goBack} />;
      case 'ObjectDetection':
        return <ObjectDetectionScreen onBack={goBack} />;
      case 'CameraOCR':
        return <CameraOCRScreen onBack={goBack} />;
      case 'EmergencyContacts':
        return <EmergencyContactsScreen onBack={goBack} />;
      case 'SavedLocations':
        return <SavedLocationsScreen onNavigate={navigateTo} onBack={goBack} />;
      case 'ArticleReader':
        return <ArticleReaderScreen onBack={goBack} />;
      case 'Settings':
        return <SettingsScreen onNavigate={navigateTo} onBack={goBack} />;
      case 'MoreMenu':
        return <MoreMenuScreen onNavigate={navigateTo} onBack={goBack} />;
      case 'Dashboard':
      default:
        return <DashboardScreen onNavigate={navigateTo} />;
    }
  };

  return (
    <View style={styles.nativeContainer}>
      <View style={styles.screenContainer}>{renderActiveScreen()}</View>
      <BottomNav activeScreen={currentScreen} onSelectScreen={navigateTo} />
    </View>
  );
}

export default function App() {
  // Modes: 'native' (Accessible single-tap, spoken cues, native camera & GPS), 'cloud' (Web HTTPS), 'local' (LAN Dev)
  const [mode, setMode] = useState('native');
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const webViewRef = useRef(null);

  const activeUrl = mode === 'local' ? LOCAL_URL : CLOUD_URL;

  // Intercept special schemes (tel:, sms:, mailto:, geo:) so native dialer & map apps open directly
  const handleShouldStartLoad = (request) => {
    const { url } = request;
    if (
      url.startsWith('tel:') ||
      url.startsWith('sms:') ||
      url.startsWith('mailto:') ||
      url.startsWith('geo:') ||
      url.startsWith('intent:')
    ) {
      Linking.openURL(url).catch((err) => {
        console.warn('Could not launch system handler for:', url, err);
        Alert.alert('Action Required', `Launch application for ${url}?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open', onPress: () => Linking.openURL(url) },
        ]);
      });
      return false; // Prevent WebView from trying to navigate to tel: schema as HTTP
    }
    return true;
  };

  // Hardware Android back button navigates WebView history
  useEffect(() => {
    if (Platform.OS === 'android' && mode !== 'native') {
      const onBackPress = () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => sub.remove();
    }
  }, [canGoBack, mode]);

  const cycleMode = () => {
    if (mode === 'native') setMode('cloud');
    else if (mode === 'cloud') setMode('local');
    else setMode('native');
    setHasError(false);
  };

  return (
    <SafeAreaView style={styles.safeContainer}>
      <ExpoStatusBar style="light" backgroundColor="#05080f" />

      {/* Top App Control Bar */}
      <View style={styles.topControlBar}>
        <View style={styles.brandRow}>
          <View style={styles.liveIndicator} />
          <Text style={styles.brandText}>VisionGuide AI</Text>
        </View>

        <View style={styles.controlButtons}>
          <TouchableOpacity style={styles.modePill} onPress={cycleMode} activeOpacity={0.7}>
            <Text style={styles.modePillText}>
              {mode === 'cloud' && '🌐 Cloud'}
              {mode === 'local' && '💻 Local (3000)'}
              {mode === 'native' && '📱 Native'}
            </Text>
          </TouchableOpacity>

          {mode !== 'native' && (
            <TouchableOpacity
              style={styles.refreshBtn}
              onPress={() => {
                setHasError(false);
                webViewRef.current?.reload();
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.refreshText}>🔄</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Body */}
      {mode === 'native' ? (
        <AccessibilityProvider>
          <AuthProvider>
            <NativeNavigator onSwitchToWeb={() => setMode('cloud')} />
          </AuthProvider>
        </AccessibilityProvider>
      ) : hasError ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Could not load {mode === 'local' ? 'Local Server' : 'Cloud App'}</Text>
          <Text style={styles.errorSub}>{errorMessage || 'Please check network connection.'}</Text>
          <View style={styles.errorActionRow}>
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => {
                setHasError(false);
                webViewRef.current?.reload();
              }}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: '#10b981' }]}
              onPress={() => {
                setMode(mode === 'cloud' ? 'local' : 'cloud');
                setHasError(false);
              }}
            >
              <Text style={styles.retryBtnText}>Switch to {mode === 'cloud' ? 'Local' : 'Cloud'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <WebView
          ref={webViewRef}
          source={{ uri: activeUrl }}
          style={styles.webView}
          // Enable camera, microphone, GPS, inline media
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          geolocationEnabled={true}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          originWhitelist={['*']}
          androidHardwareAccelerationDisabled={false}
          // Android hardware permission granting (Camera, Microphone)
          onPermissionRequest={(request) => {
            try {
              request.grant(request.resources);
            } catch (e) {
              console.warn('Permission grant error:', e);
            }
          }}
          // Intercept phone calls, SMS, external URLs
          onShouldStartLoadWithRequest={handleShouldStartLoad}
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
          }}
          startInLoadingState={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#10b981" />
              <Text style={styles.loadingText}>Loading VisionGuide AI...</Text>
            </View>
          )}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('WebView error: ', nativeEvent);
            setErrorMessage(nativeEvent.description || 'Connection failed.');
            setHasError(true);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#05080f',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  topControlBar: {
    height: 42,
    backgroundColor: '#0c1222',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  liveIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  brandText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  controlButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modePill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
  },
  modePillText: {
    color: '#34d399',
    fontSize: 11,
    fontWeight: '700',
  },
  refreshBtn: {
    padding: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 6,
  },
  refreshText: {
    fontSize: 14,
  },
  webView: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  nativeContainer: {
    flex: 1,
  },
  screenContainer: {
    flex: 1,
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#05080f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    flex: 1,
    backgroundColor: '#05080f',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  errorSub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  errorActionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  retryBtn: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
});
