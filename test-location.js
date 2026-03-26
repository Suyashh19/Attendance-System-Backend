const { getDistance, isWithinRadius } = require('./src/services/locationService');

function test(name, sessionLat, sessionLng, studentLat, studentLng, accuracy, radius, expected) {
  const result = isWithinRadius(sessionLat, sessionLng, studentLat, studentLng, accuracy, radius);
  const pass = result.valid === expected;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`  Distance: ${result.distance}m, Accuracy: ${result.effectiveAccuracy}m, Radius: ${radius}m`);
  console.log(`  Result: ${result.valid}, Expected: ${expected}`);
  if (!pass) process.exit(1);
}

console.log("Starting Location Service Tests...\n");

// Case 1: Student exactly at limit (80m), no accuracy adjustment
test("Exact limit, no accuracy", 16.5531439, 74.1623469, 16.5531439 + 0.00072, 74.1623469, 0, 80, true);

// Case 2: Student at 120m, 50m accuracy (120 - 50 = 70 <= 80) -> VALID
test("Distance 120m, Accuracy 50m", 16.5531439, 74.1623469, 16.5531439 + 0.00108, 74.1623469, 50, 80, true);

// Case 3: Student at 150m, 20m accuracy (150 - 20 = 130 > 80) -> INVALID
test("Distance 150m, Accuracy 20m", 16.5531439, 74.1623469, 16.5531439 + 0.00135, 74.1623469, 20, 80, false);

// Case 4: High accuracy drift (capped at 100m)
test("High drift 200m adjustment cap", 16.5531439, 74.1623469, 16.5531439 + 0.00180, 74.1623469, 150, 80, false); 
// 200m distance - 100m (cap) = 100m > 80m -> INVALID

console.log("\nAll tests passed!");
