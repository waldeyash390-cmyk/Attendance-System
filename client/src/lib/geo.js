const EARTH_RADIUS_METERS = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two WGS84 points using the Haversine
// formula. Returns meters, or null for invalid coordinates.
function coord(v) {
  // Note: Number(null)/Number('') are 0, so exclude them explicitly.
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

export function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const a1 = coord(lat1);
  const o1 = coord(lng1);
  const a2 = coord(lat2);
  const o2 = coord(lng2);
  if (![a1, o1, a2, o2].every((v) => Number.isFinite(v))) return null;
  if (Math.abs(a1) > 90 || Math.abs(a2) > 90) return null;
  if (Math.abs(o1) > 180 || Math.abs(o2) > 180) return null;

  const dLat = toRad(a2 - a1);
  const dLng = toRad(o2 - o1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a1)) * Math.cos(toRad(a2)) * sinLng * sinLng;
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_METERS * c;
}

// Promise wrapper around navigator.geolocation.getCurrentPosition.
// Resolves { lat, lng, accuracy } or rejects with an Error.
export function getCurrentPosition(options) {
  return new Promise((resolve, reject) => {
    if (!navigator || !navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
      reject(new Error('Geolocation is not supported by this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        let msg = 'Failed to get your location.';
        if (err && err.code === err.PERMISSION_DENIED) msg = 'Location permission denied. Please allow location access and try again.';
        else if (err && err.code === err.POSITION_UNAVAILABLE) msg = 'Your location is currently unavailable.';
        else if (err && err.code === err.TIMEOUT) msg = 'Getting your location timed out. Please try again.';
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0, ...(options || {}) },
    );
  });
}

export function formatCoords(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return '-';
  return `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
}
