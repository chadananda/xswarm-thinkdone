// Google OAuth callback — exchanges code for tokens, redirects to /settings with tokens in hash
export async function GET({ request, url }) {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  //
  if (error || !code) {
    return new Response(`<html><body><p>OAuth error: ${error || 'no code'}</p><a href="/settings">Back to settings</a></body></html>`, {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }
  //
  const clientId = import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const origin = url.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;
  //
  let tokenRes;
  try {
    tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
  } catch (fetchErr) {
    return new Response(`<html><body><p>Fetch error: ${fetchErr.message}</p><a href="/settings">Back to settings</a></body></html>`, {
      status: 500, headers: { 'Content-Type': 'text/html' },
    });
  }
  //
  if (!tokenRes.ok) {
    const errText = await tokenRes.text().catch(() => 'Unknown error');
    return new Response(`<html><body><p>Token exchange failed: ${errText}</p><a href="/settings">Back to settings</a></body></html>`, {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
  }
  //
  const tokens = await tokenRes.json();
  // Decode JWT id_token for user info (no verification needed — just display)
  let userInfo = {};
  if (tokens.id_token) {
    try {
      const payload = tokens.id_token.split('.')[1];
      const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
      userInfo = JSON.parse(decoded);
    } catch {}
  }
  //
  const tokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
    email: userInfo.email || '',
    name: userInfo.name || '',
    picture: userInfo.picture || '',
  };
  //
  // Redirect to /settings with tokens in URL hash (hash is never sent to server)
  const hash = encodeURIComponent(JSON.stringify(tokenData));
  return new Response(null, {
    status: 302,
    headers: { Location: `/settings#google_tokens=${hash}` },
  });
}
