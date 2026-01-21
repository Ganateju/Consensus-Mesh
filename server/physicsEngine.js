/**
 * physicsEngine.js - The Consensus Mesh Spherical Shield
 * * ⚛️ CORE CONCEPT:
 * We map the classroom into a multi-dimensional "Signal Space." 
 * Each unique WiFi Access Point (AP) acts as a coordinate axis (Dimension).
 * * 1. The Teacher's scan is the ORIGIN (0,0,0...n).
 * 2. The Student's scan is a POINT in that n-dimensional space.
 * 3. Displacement is calculated using the Euclidean Distance formula.
 * 4. "Wall-Guard" monitors signal variance to detect physical barriers.
 */

require('dotenv').config();

/**
 * Validates student proximity using Spherical Displacement and Wall Attenuation.
 * @param {Object} studentWifi - { SSID: RSSI_Level }
 * @param {Object} masterWifi  - { SSID: RSSI_Level }
 */
const validateBubbleBoundary = (studentWifi, masterWifi) => {
    try {
        // Global Bypass: Check if the admin has toggled the physics guard off
        if (process.env.PHYSICS_ENABLED !== 'true') {
            return { valid: true, bubbleDistance: 0, status: "Physics Shield Disabled" };
        }

        // Check for empty inputs to prevent Math errors
        if (!studentWifi || !masterWifi || Object.keys(masterWifi).length === 0) {
            return { valid: false, bubbleDistance: 99.9, status: "Missing Environment Data" };
        }

        let sumSquaredDifferences = 0;
        let commonPoints = 0;
        let wallObstructionHits = 0;

        // Iterate through the Teacher's anchor points (Dimensions)
        for (const ssid in masterWifi) {
            if (Object.prototype.hasOwnProperty.call(studentWifi, ssid)) {
                const teacherRSSI = masterWifi[ssid];
                const studentRSSI = studentWifi[ssid];
                
                // Calculate the displacement in this specific dimension
                const signalGap = teacherRSSI - studentRSSI;

                /**
                 * 🛡️ WALL-GUARD LOGIC:
                 * Signal decay through open air follows the Inverse Square Law. 
                 * Concrete walls/blackboards cause "Non-Linear Shadowing."
                 * If a specific signal drops > 22dB relative to the anchor, it flags an obstruction.
                 */
                if (Math.abs(signalGap) > 22) {
                    wallObstructionHits++;
                }

                /**
                 * 📏 EUCLIDEAN BUBBLE MATH:
                 * d² = (x2-x1)² + (y2-y1)² + ... (n2-n1)²
                 * Squaring the gap penalizes outliers (students moving away) 
                 * while ignoring minor signal "jitter."
                 */
                sumSquaredDifferences += Math.pow(signalGap, 2);
                commonPoints++;
            }
        }

        // MESH CONFIDENCE: 
        // We require at least 2 common dimensions to define a "Sphere" in signal space.
        if (commonPoints < 2) {
            return { 
                valid: false, 
                bubbleDistance: 99.9, 
                status: "Insufficient Mesh Overlap" 
            };
        }

        /**
         * 🔮 THE RADIAL DISPLACEMENT (Bubble Distance)
         * Root Mean Square (RMS) calculation to determine the final 
         * displacement from the teacher's origin point.
         */
        const bubbleDistance = Math.sqrt(sumSquaredDifferences / commonPoints);
        
        // Dynamic Calibration: Fetched from Admin Dashboard (Default 12.0)
        const maxAllowedRadius = parseFloat(process.env.MAX_ROOM_RADIUS) || 12.0;

        /**
         * ⚖️ MULTI-FACTOR VERIFICATION:
         * 1. Distance Check: Is the student inside the radial sphere?
         * 2. Obstruction Check: Is the path clear of physical walls?
         */
        const isBehindWall = wallObstructionHits >= 2; 
        const isInsideBubble = bubbleDistance <= maxAllowedRadius;

        return {
            valid: isInsideBubble && !isBehindWall,
            bubbleDistance: parseFloat(bubbleDistance.toFixed(2)),
            limit: maxAllowedRadius,
            isBehindWall: isBehindWall,
            meshConfidence: commonPoints, 
            status: isBehindWall ? "Obstruction Detected (Wall-Guard)" : "Clear Signal Path"
        };

    } catch (error) {
        console.error("Physics Engine Error:", error);
        return { valid: false, bubbleDistance: 99.9, status: "Engine Computation Error" };
    }
};

module.exports = { validateBubbleBoundary };