import { useState, useEffect } from 'react';
import * as Location from 'expo-location';

interface Coords { latitude: number; longitude: number; accuracy?: number; }

export const useLocation = (watch = false) => {
  const [location, setLocation]   = useState<Coords | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    let subscription: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        setLoading(false);
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude, accuracy: current.coords.accuracy ?? undefined });
      setLoading(false);

      if (watch) {
        subscription = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 20, timeInterval: 10000 },
          (loc) => setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? undefined })
        );
      }
    })();

    return () => { subscription?.remove(); };
  }, [watch]);

  return { location, error, loading };
};
