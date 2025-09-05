import axios from 'axios';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.status(400).json({ error: 'OAuth authentication failed', details: error });
        }

        if (!code || !state) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // stateパラメータをデコード
        let decodedState;
        try {
            decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
        } catch (decodeError) {
            return res.status(400).json({ error: 'Invalid state parameter', details: decodeError.message });
        }
        
        const { return_domain, app_id, state: originalState } = decodedState;

        console.log('Decoded state:', decodedState);

        res.json({ message: 'OAuth callback received successfully', decodedState });

    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}
