/**
 * locationService.js
 * Haversine formula to compute distance between two GPS coordinates.
 */

const EARTH_RADIUS_M = 6371000; // metres

/**
 * Convert degrees to radians
 * @param {number} deg
 * @returns {number}
 */
function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Calculate the distance between two GPS coordinates using the Haversine formula.
 * @param {number} lat1  - Latitude of point A  (degrees)
 * @param {number} lng1  - Longitude of point A (degrees)
 * @param {number} lat2  - Latitude of point B  (degrees)
 * @param {number} lng2  - Longitude of point B (degrees)
 * @returns {number} Distance in metres
 */
function getDistance(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Check whether a student's GPS location is within the allowed radius of the
 * session anchor point.
 * @param {number} sessionLat     - Faculty/session anchor latitude
 * @param {number} sessionLng     - Faculty/session anchor longitude
 * @param {number} studentLat     - Student submitted latitude
 * @param {number} studentLng     - Student submitted longitude
 * @param {number} [radiusM=50]   - Allowed radius in metres (default 50 m)
 * @returns {{ valid: boolean, distance: number }}
 */
function isWithinRadius(sessionLat, sessionLng, studentLat, studentLng, radiusM = 50) {
  const distance = getDistance(sessionLat, sessionLng, studentLat, studentLng);
  return {
    valid: distance <= radiusM,
    distance: Math.round(distance),
  };
}

module.exports = { getDistance, isWithinRadius };
