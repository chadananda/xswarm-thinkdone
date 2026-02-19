// Google OAuth initiation — redirects to Google consent screen
// User clicks "Connect Google" → GET /api/auth/google → 302 to Google
export async function GET({ request, url }) {
  const clientId = import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return new Response(JSON.stringify({ error: 'GOOGLE_CLIENT_ID not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  //
  const origin = url.origin;
  const redirectUri = `${origin}/api/auth/google/callback`;
  const scope = 'https://www.googleapis.com/auth/generative-language.retriever openid email profile';
  //
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
  });
  //
  return new Response(null, {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
  });
}
