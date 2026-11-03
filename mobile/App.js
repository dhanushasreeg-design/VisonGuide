import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  SafeAreaView,
  View,
  BackHandler,
  Platform,
  StatusBar,
} from 'react-native';
import { StatusBar as ExpoStatusBar } from 'expo-status-bar';

// Context Providers
import { AuthProvider } from './src/context/AuthContext';
import { AccessibilityProvider } from './src/context/AccessibilityContext';

// Components
import BottomNav from './src/components/BottomNav';

// Screens
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

function MainNavigator() {
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
      nextHistory.pop(); // Remove current
      const prevScreen = nextHistory[nextHistory.length - 1];
      setHistory(nextHistory);
      setCurrentScreen(prevScreen);
      return true;
    }
    return false;
  };

  // Hardware Android back button support
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
    <SafeAreaView style={styles.safeContainer}>
      <ExpoStatusBar style="light" backgroundColor="#05080f" />
      <View style={styles.screenContainer}>{renderActiveScreen()}</View>
      <BottomNav activeScreen={currentScreen} onSelectScreen={navigateTo} />
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <AccessibilityProvider>
      <AuthProvider>
        <MainNavigator />
      </AuthProvider>
    </AccessibilityProvider>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#05080f',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  screenContainer: {
    flex: 1,
  },
});
