/**
 * physicsEngine.js - The Consensus Mesh Spherical Shield (Zero-Trust Edition)
 */

require('dotenv').config();

/**
 * Validates student proximity using N-Dimensional Euclidean Displacement.
 * @param {Object} studentWifi - { SSID: RSSI_Level }
 * @param {Object} masterWifi  - { SSID: RSSI_Level }
 * @param {Object} sessionSettings - { threshold, maxRadius, physicsEnabled }
 */
const validateBubbleBoundary = (studentWifi, masterWifi, sessionSettings = {}) => {
    try {
        // 1. Dynamic Settings Extraction (Teacher-Calibrated or Global Fallback)
        const physicsEnabled = sessionSettings.physicsEnabled ?? (process.env.PHYSICS_ENABLED === 'true');
        const maxAllowedRadius = parseFloat(sessionSettings.maxRadius) || parseFloat(process.env.MAX_ROOM_RADIUS) || 12.0;
        
        if (!physicsEnabled) {
            return { valid: true, bubbleDistance: 0, status: "Physics Shield Bypassed" };
        }

        if (!studentWifi || !masterWifi || Object.keys(masterWifi).length === 0) {
            return { valid: false, bubbleDistance: 99.9, status: "Missing Signal Map" };
        }

        let sumSquaredDifferences = 0;
        let commonPoints = 0;
        let wallObstructionHits = 0;
        
        // 🛡️ WALL-GUARD CALIBRATION
        const ATTENUATION_THRESHOLD = 22; 

        // 2. N-Dimensional Signal Mapping
        for (const ssid in masterWifi) {
            if (Object.prototype.hasOwnProperty.call(studentWifi, ssid)) {
                const teacherRSSI = masterWifi[ssid];
                const studentRSSI = studentWifi[ssid];
                
                // Euclidean Delta per Dimension
                const signalGap = teacherRSSI - studentRSSI;

                /**
                 * 🧱 MATERIAL ATTENUATION AUDIT
                 * Detects non-linear signal drops that indicate physical barriers.
                 */
                if (Math.abs(signalGap) > ATTENUATION_THRESHOLD) {
                    wallObstructionHits++;
                }

                /**
                 * 📐 EUCLIDEAN DISTANCE (Multi-Dimensional)
                 * Calculation: sum of squared differences across all shared WiFi dimensions.
                 */
                sumSquaredDifferences += Math.pow(signalGap, 2);
                commonPoints++;
            }
        }

        // 3. MESH CONFIDENCE CHECK
        if (commonPoints < 2) {
            return { 
                valid: false, 
                bubbleDistance: 99.9, 
                status: "Mesh Overlap Failure" 
            };
        }

        /**
         * 🔮 RADIAL DISPLACEMENT (RMS Calculation)
         * Equation: $$d = \sqrt{\frac{\sum_{i=1}^{n} (T_i - S_i)^2}{n}}$$
         */
        const bubbleDistance = Math.sqrt(sumSquaredDifferences / commonPoints);
        
        

        /**
         * ⚖️ ZERO-TRUST DECISION LOGIC
         * We verify that the student is within the sphere AND not behind a concrete wall.
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