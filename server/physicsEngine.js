/**
 * physicsEngine.js - The Consensus Mesh Spherical Shield (Elite Zero-Trust Edition)
 */

require('dotenv').config();

/**
 * Validates student proximity using N-Dimensional Euclidean Displacement.
 * Logic optimized to account for hardware variance (phone cases, antennas).
 */
const validateBubbleBoundary = (studentWifi, masterWifi, sessionSettings = {}) => {
    try {
        // 1. DYNAMIC CONFIGURATION
        const physicsEnabled = sessionSettings.physicsEnabled ?? (process.env.PHYSICS_ENABLED === 'true');
        
        // Increase default radius slightly to 18.0 for better indoor coverage 
        const maxAllowedRadius = parseFloat(sessionSettings.maxRadius) || 18.0; 
        
        if (!physicsEnabled) {
            return { valid: true, bubbleDistance: 0, status: "Physics Shield Bypassed" };
        }

        if (!studentWifi || !masterWifi || Object.keys(masterWifi).length === 0) {
            return { valid: false, bubbleDistance: 99.9, status: "Incomplete Signal Map" };
        }

        let sumSquaredDifferences = 0;
        let commonPoints = 0;
        let wallObstructionHits = 0;
        
        // 🛡️ REFINED WALL-GUARD THRESHOLD
        // 26dB is a high-confidence threshold that ignores minor drops from hand-interference.
        const ATTENUATION_THRESHOLD = 26; 

        // 2. N-DIMENSIONAL SIGNAL MAPPING
        for (const ssid in masterWifi) {
            if (Object.prototype.hasOwnProperty.call(studentWifi, ssid)) {
                const teacherRSSI = masterWifi[ssid];
                const studentRSSI = studentWifi[ssid];
                
                // Euclidean Delta per Dimension
                const signalGap = teacherRSSI - studentRSSI;

                /**
                 * 🧱 PERCENTAGE-BASED WALL AUDIT
                 * Detects non-linear signal drops indicating physical barriers.
                 */
                if (Math.abs(signalGap) > ATTENUATION_THRESHOLD) {
                    wallObstructionHits++;
                }

                sumSquaredDifferences += Math.pow(signalGap, 2);
                commonPoints++;
            }
        }

        // 3. MESH CONFIDENCE CHECK
        // Require at least 2 common routers to perform vector math.
        if (commonPoints < 2) {
            return { 
                valid: false, 
                bubbleDistance: 99.9, 
                status: "Low Mesh Confidence" 
            };
        }

        /**
         * 🔮 RADIAL DISPLACEMENT (RMS Calculation)
         * Formula: Root Mean Square of the Signal Gap
         */
        const bubbleDistance = Math.sqrt(sumSquaredDifferences / commonPoints);

        /**
         * ⚖️ ZERO-TRUST DECISION LOGIC
         * A student is valid if they are inside the radius AND not flagged by Wall-Guard.
         */
        
        // Logical Fix: A "Wall" is only confirmed if at least 40% of shared signals 
        // show a massive drop. This prevents one oscillating router from flagging a student.
        const isBehindWall = wallObstructionHits >= (commonPoints * 0.4) && wallObstructionHits >= 3; 
        const isInsideBubble = bubbleDistance <= maxAllowedRadius;

        return {
            valid: isInsideBubble && !isBehindWall,
            bubbleDistance: parseFloat(bubbleDistance.toFixed(2)),
            limit: maxAllowedRadius,
            isBehindWall: isBehindWall,
            meshConfidence: commonPoints, 
            status: isBehindWall ? "Obstruction Detected" : (isInsideBubble ? "Inside Mesh" : "Outside Bubble")
        };

    } catch (error) {
        console.error("CRITICAL PHYSICS ERROR:", error);
        return { valid: false, bubbleDistance: 99.9, status: "Mathematical Fault" };
    }
};

module.exports = { validateBubbleBoundary };