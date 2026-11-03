import AsyncStorage from '@react-native-async-storage/async-storage';

// In Expo Go on a physical phone, localhost points to the phone itself.
// We use the computer's local Wi-Fi IP address (192.168.1.9) to reach the backend.
export const BACKEND_BASE = 'http://192.168.1.9:5000/api';
export const TOKEN_KEY = 'visionguide_native_token';
export const USER_KEY = 'visionguide_native_user';

export async function apiRequest(endpoint, method = 'GET', body = null) {
  try {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = {
      method,
      headers,
    };
    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(body);
    }

    const url = endpoint.startsWith('http') ? endpoint : `${BACKEND_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    options.signal = controller.signal;

    const res = await fetch(url, options);
    clearTimeout(timeoutId);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Request failed with status ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Network request timed out. Please verify backend is running on 192.168.1.9:5000.');
    }
    throw error;
  }
}
