import axios from 'axios';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let decodedState = null; // ここで宣言

    try {
        const { code, state, error } = req.query;

        if (error) {
            return res.status(400).json({ error: 'OAuth authentication failed', details: error });
        }

        if (!code || !state) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // stateパラメータをデコード
        try {
            decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
        } catch (decodeError) {
            return res.status(400).json({ error: 'Invalid state parameter', details: decodeError.message });
        }
        
        const { return_domain, app_id, state: originalState } = decodedState;

        // テスト用の場合は成功レスポンスを返す
        if (code === 'test') {
            return res.json({ 
                message: 'OAuth callback test successful', 
                decodedState,
                customerKey: 'test_customer_key_12345'
            });
        }

        // 実際のOAuth処理（以下は実際の認証コードでのみ実行）
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: `https://kintone-gmail-auth.vercel.app/api/oauth/callback`
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const tokenData = tokenResponse.data;

        if (!tokenData.access_token) {
            throw new Error('Failed to obtain access token');
        }

        // ユーザー情報を取得
        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        const userInfo = userResponse.data;

        // カスタマーキーを生成
        const customerKey = generateCustomerKey();

        // Zapierテーブルにデータを送信（仮のURLの場合はスキップ）
        if (process.env.ZAPIER_WEBHOOK_URL && !process.env.ZAPIER_WEBHOOK_URL.includes('your-webhook-id')) {
            const zapierData = {
                customer_key: customerKey,
                email: userInfo.email,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                token_type: tokenData.token_type,
                expires_in: tokenData.expires_in,
                expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString(),
                created_at: new Date().toISOString(),
                kintone_domain: return_domain,
                app_id: app_id,
                user_name: userInfo.name,
                user_picture: userInfo.picture
            };

            await axios.post(process.env.ZAPIER_WEBHOOK_URL, zapierData);
        }

        // kintoneにリダイレクトしてトークン情報を渡す
        const redirectUrl = `${return_domain}/k/${app_id}/` + 
            `?auth_success=1&customer_key=${customerKey}&email=${encodeURIComponent(userInfo.email)}`;

        res.redirect(redirectUrl);

    } catch (error) {
        console.error('OAuth callback error:', error);
        
        // エラー情報をkintoneに返す
        const returnDomain = decodedState?.return_domain || 'about:blank';
        const errorUrl = `${returnDomain}` + 
            `?auth_error=1&error_message=${encodeURIComponent(error.message)}`;
        
        res.redirect(errorUrl);
    }
}

function generateCustomerKey() {
    return 'customer_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
