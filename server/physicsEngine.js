/**
 * physicsEngine.js - The Consensus Mesh Spherical Shield
 * * CORE LOGIC:
 * We map the classroom into a multi-dimensional "Signal Space" where each unique 
 * WiFi Access Point (AP) acts as a coordinate axis. 
 * * The Teacher's scan becomes the ORIGIN (0,0,0).
 * The Student's scan becomes a POINT in this space.
 * * We then calculate the 'Euclidean Displacement' (The Bubble Distance). 
 * If the student is too far from the origin, or if a physical barrier (wall) 
 * is detected between them, the "Shield" flags them as Absent.
 */

require('dotenv').config();

/**
 * @param {Object} studentWifi - WiFi map from student scan { SSID: RSSI }
 * @param {Object} masterWifi  - WiFi map from teacher anchor { SSID: RSSI }
 */
const validateBubbleBoundary = (studentWifi, masterWifi) => {
    
    // Safety Switch: Allow Admin to disable the physics engine for testing
    if (process.env.PHYSICS_ENABLED !== 'true') {
        return { valid: true, bubbleDistance: 0 };
    }

    let sumSquaredDifferences = 0;
    let commonPoints = 0;
    let wallObstructionHits = 0;

    // Cross-referencing the Teacher's anchor environment with the Student's current view
    for (const ssid in masterWifi) {
        if (studentWifi.hasOwnProperty(ssid)) {
            const teacherRSSI = masterWifi[ssid];
            const studentRSSI = studentWifi[ssid];
            
            // The signal gap (how much weaker/stronger is the student's signal?)
            const signalGap = teacherRSSI - studentRSSI;

            /**
             * 🛡️ WALL-GUARD DETECTION:
             * Normal signal decay over air is gradual. However, passing through 
             * concrete walls or heavy blackboards causes a "Disproportionate Drop."
             * If a reliable router drops by > 22dB, we record a physical obstruction hit.
             */
            if (Math.abs(signalGap) > 22) {
                wallObstructionHits++;
            }

            /**
             * 📏 EUCLIDEAN BUBBLE MATH:
             * We calculate the squared difference for the distance formula: (x1 - x2)^2
             * This ensures that small signal jitters are ignored, but large 
             * movements away from the teacher are penalized exponentially.
             */
            sumSquaredDifferences += Math.pow(signalGap, 2);
            commonPoints++;
        }
    }

    // MESH CONFIDENCE: If the devices don't share enough Access Points (APs), 
    // the environment is too sparse to build a reliable coordinate bubble.
    if (commonPoints < 2) {
        return { 
            valid: false, 
            bubbleDistance: 99.9, 
            status: "Insufficient Mesh Overlap" 
        };
    }

    /**
     * 🔮 THE BUBBLE RADIUS (Signal Displacement)
     * We calculate the Root Mean Square (RMS) of the differences.
     * This represents the 'Radial Distance' from the Teacher in Signal Space.
     */
    const bubbleDistance = Math.sqrt(sumSquaredDifferences / commonPoints);
    
    // FETCH LIVE CALIBRATION: This value is synced from your Admin Dashboard slider
    const maxAllowedRadius = parseFloat(process.env.MAX_ROOM_RADIUS) || 12.0;

    /**
     * ⚖️ FINAL DECISION ENGINE:
     * A student is only 'Present' if they satisfy TWO physical conditions:
     * 1. RADIAL CHECK: Are they inside the bubble radius?
     * 2. MATERIAL CHECK: Is the signal path clear of heavy obstructions (Walls)?
     */
    const isBehindWall = wallObstructionHits >= 2; // Triggered if 2+ signals show "Wall-like" decay
    const isInsideBubble = bubbleDistance <= maxAllowedRadius;

    return {
        valid: isInsideBubble && !isBehindWall,
        bubbleDistance: parseFloat(bubbleDistance.toFixed(2)),
        limit: maxAllowedRadius,
        isBehindWall: isBehindWall,
        meshConfidence: commonPoints, 
        status: isBehindWall ? "Obstruction Detected" : "Clear Signal Path"
    };
};

module.exports = { validateBubbleBoundary };