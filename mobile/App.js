import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  SafeAreaView,
  BackHandler,
  Platform,
  StatusBar,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

// Default to local Wi-Fi server, fallback to live GitHub Pages production app
const LOCAL_URL = 'http://192.168.1.9:3000';
const CLOUD_URL = 'https://dhanushasreeg-design.github.io/VisonGuide/';

export default function App() {
  const [currentUrl, setCurrentUrl] = useState(LOCAL_URL);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef(null);

  // Handle hardware Android back button to navigate web history
  useEffect(() => {
    if (Platform.OS === 'android') {
      const onBackPress = () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      };
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }
  }, [canGoBack]);

  const handleRetry = () => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  };

  const toggleEndpoint = () => {
    const next = currentUrl === LOCAL_URL ? CLOUD_URL : LOCAL_URL;
    setCurrentUrl(next);
    setHasError(false);
    setIsLoading(true);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ExpoStatusBar style="light" backgroundColor="#05080f" />

      {/* Top App Bar inside Expo Go */}
      <View style={styles.topHeader}>
        <View style={styles.titleRow}>
          <Text style={styles.headerIcon}>👁️</Text>
          <Text style={styles.headerTitle}>
            VisionGuide <Text style={styles.greenText}>AI</Text>
          </Text>
        </View>

        <TouchableOpacity style={styles.switchBtn} onPress={toggleEndpoint}>
          <Text style={styles.switchBtnText}>
            {currentUrl === LOCAL_URL ? '🌐 Switch to Cloud' : '💻 Switch to Local'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Embedded Web App View */}
      <View style={styles.webContainer}>
        <WebView
          ref={webViewRef}
          source={{ uri: currentUrl }}
          style={styles.webView}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          geolocationEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsBackForwardNavigationGestures={true}
          originWhitelist={['*']}
          mixedContentMode="always"
          onNavigationStateChange={(navState) => {
            setCanGoBack(navState.canGoBack);
          }}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          renderError={() => (
            <View style={styles.errorBox}>
              <Text style={styles.errorEmoji}>⚠️</Text>
              <Text style={styles.errorTitle}>Connection Required</Text>
              <Text style={styles.errorDesc}>
                {currentUrl === LOCAL_URL
                  ? 'Could not connect to local dev server (192.168.1.9:3000). Make sure your phone is on the same Wi-Fi, or switch to Cloud.'
                  : 'Could not load live cloud app. Please check your internet connection.'}
              </Text>

              <View style={styles.btnRow}>
                <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
                  <Text style={styles.retryBtnText}>🔄 Retry</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.cloudBtn} onPress={toggleEndpoint}>
                  <Text style={styles.cloudBtnText}>
                    {currentUrl === LOCAL_URL ? '🌐 Switch to Cloud App' : '💻 Switch to Local IP'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />

        {/* Loading Overlay */}
        {isLoading && !hasError && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#22c55e" />
            <Text style={styles.loadingText}>Loading VisionGuide AI…</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05080f',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  topHeader: {
    height: 48,
    backgroundColor: '#0d1117',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerIcon: {
    fontSize: 18,
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#f9fafb',
  },
  greenText: {
    color: '#22c55e',
  },
  switchBtn: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)',
  },
  switchBtnText: {
    color: '#4ade80',
    fontSize: 11,
    fontWeight: '700',
  },
  webContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#05080f',
  },
  webView: {
    flex: 1,
    backgroundColor: '#05080f',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#05080f',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#05080f',
  },
  errorEmoji: {
    fontSize: 44,
    marginBottom: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#f87171',
    marginBottom: 8,
  },
  errorDesc: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'column',
    gap: 10,
    width: '100%',
    maxWidth: 280,
  },
  retryBtn: {
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  cloudBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  cloudBtnText: {
    color: '#f9fafb',
    fontWeight: '600',
    fontSize: 13,
  },
});
