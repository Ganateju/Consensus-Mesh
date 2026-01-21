/**
 * physicsEngine.js - The Consensus Mesh Spherical Shield (Zero-Trust Edition)
 */

require('dotenv').config();

/**
 * Validates student proximity using N-Dimensional Euclidean Displacement.
 * @param {Object} studentWifi - { SSID: RSSI_Level }
 * @param {Object} masterWifi  - { SSID: RSSI_Level }
 */
const validateBubbleBoundary = (studentWifi, masterWifi) => {
    try {
        // 1. Global Safety Bypass
        if (process.env.PHYSICS_ENABLED !== 'true') {
            return { valid: true, bubbleDistance: 0, status: "Physics Bypass Active" };
        }

        if (!studentWifi || !masterWifi || Object.keys(masterWifi).length === 0) {
            return { valid: false, bubbleDistance: 99.9, status: "Missing Signal Map" };
        }

        let sumSquaredDifferences = 0;
        let commonPoints = 0;
        let wallObstructionHits = 0;
        
        // 🛡️ WALL-GUARD CALIBRATION: 
        // 22dB represents the average attenuation of a 4-inch concrete wall.
        const ATTENUATION_THRESHOLD = 22; 

        // 2. N-Dimensional Signal Mapping
        for (const ssid in masterWifi) {
            if (Object.prototype.hasOwnProperty.call(studentWifi, ssid)) {
                const teacherRSSI = masterWifi[ssid];
                const studentRSSI = studentWifi[ssid];
                
                // Euclidean Delta per Dimension
                const signalGap = teacherRSSI - studentRSSI;

                /**
                 * 🧱 MATERIAL ATTENUATION AUDIT:
                 * Detects non-linear signal drops that indicate physical barriers.
                 */
                if (Math.abs(signalGap) > ATTENUATION_THRESHOLD) {
                    wallObstructionHits++;
                }

                /**
                 * 📐 EUCLIDEAN DISTANCE (Multi-Dimensional):
                 * d = sqrt( sum( (T_i - S_i)^2 ) )
                 */
                sumSquaredDifferences += Math.pow(signalGap, 2);
                commonPoints++;
            }
        }

        // 3. MESH CONFIDENCE CHECK
        // If the student sees less than 2 of the teacher's anchor points, 
        // the location is unverifiable (Potential spoofing or out-of-range).
        if (commonPoints < 2) {
            return { 
                valid: false, 
                bubbleDistance: 99.9, 
                status: "Mesh Overlap Failure" 
            };
        }

        /**
         * 🔮 RADIAL DISPLACEMENT CALCULATION
         * RMS (Root Mean Square) provides the normalized distance in signal space.
         */
        const bubbleDistance = Math.sqrt(sumSquaredDifferences / commonPoints);
        const maxAllowedRadius = parseFloat(process.env.MAX_ROOM_RADIUS) || 12.0;

        /**
         * ⚖️ FINAL SHIELD DECISION
         * Condition A: Euclidean Displacement is within calibrated radius.
         * Condition B: Wall-Guard hits are below the obstruction limit (max 1 hit allowed).
         */
        const isBehindWall = wallObstructionHits >= 2; 
        const isInsideBubble = bubbleDistance <= maxAllowedRadius;

        return {
            valid: isInsideBubble && !isBehindWall,
            bubbleDistance: parseFloat(bubbleDistance.toFixed(2)),
            limit: maxAllowedRadius,
            isBehindWall: isBehindWall,
            meshConfidence: commonPoints, 
            status: isBehindWall ? "Obstruction (Wall-Guard)" : (isInsideBubble ? "Inside Mesh" : "Outside Bubble")
        };

    } catch (error) {
        console.error("CRITICAL PHYSICS ERROR:", error);
        return { valid: false, bubbleDistance: 99.9, status: "Mathematical Fault" };
    }
};

module.exports = { validateBubbleBoundary };