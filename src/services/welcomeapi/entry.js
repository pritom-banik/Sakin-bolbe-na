const investigator = require('../investigator/investigator'); 
// Express Handler: /analyze-ticket
async function welcomeapi(req, res) {
    try {
        
        if (!req.body || Object.keys(req.body).length === 0) {
            return res.status(400).json({ 
                error: "Malformed input: Request body cannot be empty." 
            });
        }

        //  Destructure fields directly from the root level of req.body per the schema contract
        const { 
            ticket_id, 
            complaint, 
            language, 
            channel, 
            user_type, 
            campaign_context, 
            transaction_history, 
            metadata 
        } = req.body;

        
        if (!ticket_id || typeof ticket_id !== 'string') {
            return res.status(400).json({ 
                error: "Malformed input: 'ticket_id' is required and must be a string." 
            });
        }

        
        if (!complaint || typeof complaint !== 'string' || complaint.trim() === '') {
            return res.status(422).json({ 
                error: "Semantic error: 'complaint' text cannot be empty." 
            });
        }

        
        const history = Array.isArray(transaction_history) ? transaction_history : [];

        // --- VALIDATION PASSED ---
        const investigationResult = await investigator.investigate({
            ticket_id,
            complaint,
            language,
            channel,
            user_type,
            campaign_context,
            transaction_history: history,
            metadata
        });

        return res.status(200).json(investigationResult);

    } catch (error) {
        console.error("Internal Log Error:", error.message); 
        return res.status(500).json({ 
            error: "Internal service error occurred while executing analysis." 
        });
    }
}

module.exports = { welcomeapi };