import axios from 'axios';

export default async function handler(req, res) {
    console.log('=== OAuth Callback Start ===');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Method:', req.method);
    console.log('Host:', req.headers.host);
    console.log('Query params:', JSON.stringify(req.query));
    console.log('Environment variables check:', {
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        hasZapierUrl: !!process.env.ZAPIER_WEBHOOK_URL,
        clientIdPrefix: process.env.GOOGLE_CLIENT_ID?.substring(0, 20),
        zapierUrlPrefix: process.env.ZAPIER_WEBHOOK_URL?.substring(0, 50)
    });

    if (req.method !== 'GET') {
        console.log('Method not allowed:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    let decodedState = null;

    try {
        const { code, state, error } = req.query;

        console.log('Query parameters:', { code: !!code, state: !!state, error });

        if (error) {
            console.log('OAuth error from Google:', error);
            return res.status(400).json({ error: 'OAuth authentication failed', details: error });
        }

        if (!code || !state) {
            console.log('Missing required parameters');
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        // stateパラメータをデコード
        try {
            decodedState = JSON.parse(Buffer.from(state, 'base64').toString());
            console.log('Decoded state:', decodedState);
        } catch (decodeError) {
            console.log('State decode error:', decodeError.message);
            return res.status(400).json({ error: 'Invalid state parameter', details: decodeError.message });
        }
        
        const { return_domain, app_id, state: originalState } = decodedState;

        // テスト用の場合は成功レスポンスを返す
        if (code === 'test') {
            console.log('Test mode detected');
            return res.json({ 
                message: 'OAuth callback test successful', 
                decodedState,
                customerKey: 'test_customer_key_12345'
            });
        }

        // アクセストークンを取得
        const tokenRequestData = {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: `${req.headers.host?.includes('localhost') ? 'http://localhost:3000' : 'https://kintone-gmail-auth.vercel.app'}/api/oauth/callback`
        };

        console.log('=== Token Request Debug ===');
        console.log('Request URL:', 'https://oauth2.googleapis.com/token');
        console.log('Request data:', {
            ...tokenRequestData,
            client_secret: tokenRequestData.client_secret ? 'SET' : 'NOT_SET'
        });
        console.log('Host header:', req.headers.host);
        console.log('Computed redirect_uri:', tokenRequestData.redirect_uri);

        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', tokenRequestData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        console.log('Token response status:', tokenResponse.status);
        console.log('Token response data keys:', Object.keys(tokenResponse.data));

        const tokenData = tokenResponse.data;

        if (!tokenData.access_token) {
            console.log('No access token in response');
            throw new Error('Failed to obtain access token');
        }

        console.log('Access token obtained successfully');

        // ユーザー情報を取得
        console.log('Fetching user info...');
        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: {
                'Authorization': `Bearer ${tokenData.access_token}`
            }
        });

        console.log('User info response status:', userResponse.status);
        const userInfo = userResponse.data;
        console.log('User info:', { email: userInfo.email, name: userInfo.name });

        // カスタマーキーを生成
        const customerKey = generateCustomerKey(return_domain);
        console.log('Generated customer key:', customerKey);

        // 日付をYYYY-MM-DD形式に変換
        const expiresDate = new Date(Date.now() + (tokenData.expires_in * 1000));
        const createdDate = new Date();
        
        const zapierData = {
            mail_customer_key: customerKey,
            mail_email: userInfo.email,
            mail_access_token: tokenData.access_token,
            mail_refresh_token: tokenData.refresh_token,
            mail_token_type: tokenData.token_type,
            mail_expires_in: tokenData.expires_in,
            mail_expires_at: expiresDate.toISOString().split('T')[0],
            mail_created_at: createdDate.toISOString().split('T')[0]
        };

        console.log('Zapier data prepared:', {
            ...zapierData,
            mail_access_token: 'SET',
            mail_refresh_token: 'SET'
        });

        // Zapierテーブルにデータを送信（実際のWebhook URLの場合のみ）
        if (process.env.ZAPIER_WEBHOOK_URL && !process.env.ZAPIER_WEBHOOK_URL.includes('14502913')) {
            console.log('Skipping Zapier webhook - using placeholder URL');
        } else if (process.env.ZAPIER_WEBHOOK_URL) {
            console.log('Sending data to Zapier...');
            try {
                await axios.post(process.env.ZAPIER_WEBHOOK_URL, zapierData);
                console.log('Zapier data sent successfully');
            } catch (zapierError) {
                console.log('Zapier webhook error:', zapierError.message);
                // Zapierエラーは認証成功を妨げない
            }
        } else {
            console.log('No Zapier webhook URL configured');
        }

        // kintoneにリダイレクトしてトークン情報を渡す
        const redirectUrl = `${return_domain}/k/${app_id}/` + 
            `?auth_success=1&customer_key=${customerKey}&email=${encodeURIComponent(userInfo.email)}`;

        console.log('Redirecting to:', redirectUrl);
        res.redirect(redirectUrl);

    } catch (error) {
        console.error('=== OAuth callback error ===');
        console.error('Error type:', error.constructor.name);
        console.error('Error message:', error.message);
        console.error('Error status:', error.status);
        console.error('Error response:', error.response?.data);
        console.error('Error stack:', error.stack);
        
        // エラー情報をkintoneに返す
        const returnDomain = decodedState?.return_domain || 'about:blank';
        const errorUrl = `${returnDomain}` + 
            `?auth_error=1&error_message=${encodeURIComponent(error.message)}`;
        
        console.log('Error redirect URL:', errorUrl);
        res.redirect(errorUrl);
    }
}

function generateCustomerKey(kintoneUrl) {
    // kintoneURLからサブドメインを抽出 (例: https://example.cybozu.com → example)
    const match = kintoneUrl.match(/https:\/\/([^.]+)\.cybozu\.com/);
    const subdomain = match ? match[1] : 'unknown';
    
    return `customer_${subdomain}_${Date.now()}`;
}
