const EARTH_RADIUS_METERS = 6371008.8;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

// Great-circle distance between two WGS84 points using the Haversine
// formula. Returns meters. Returns null for invalid/missing coordinates.
function coord(v) {
  // Note: Number(null)/Number('') are 0, so exclude them explicitly.
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
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
  // Guard against floating point drift pushing h slightly above 1.
  const c = 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  return EARTH_RADIUS_METERS * c;
}

module.exports = { haversineDistanceMeters };
