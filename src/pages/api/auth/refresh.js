// Token refresh endpoint — exchanges refresh_token for new access_token
export async function POST({ request }) {
  const { refresh_token } = await request.json();
  if (!refresh_token) {
    return new Response(JSON.stringify({ error: 'Missing refresh_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  //
  const clientId = import.meta.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = import.meta.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  //
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  //
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown error');
    return new Response(JSON.stringify({ error: `Refresh failed: ${errText}` }), {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  //
  const data = await res.json();
  return new Response(JSON.stringify({
    access_token: data.access_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
