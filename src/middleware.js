// Astro middleware — set COOP/COEP headers for SharedArrayBuffer (required by OPFS WASM)
// Uses 'credentialless' instead of 'require-corp' to avoid blocking external resources
// (e.g. Google Fonts) that lack Cross-Origin-Resource-Policy headers.
export function onRequest({ request }, next) {
  return next().then(response => {
    response.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return response;
  });
}
