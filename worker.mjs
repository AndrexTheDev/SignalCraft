// Serve an independently prerendered document for each existing language URL.
// Asset binding requests bypass this Worker; private generated paths are never public URLs.
const languages = new Set(['de', 'en', 'es', 'ar', 'zh']);
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let path;
    try { path = decodeURIComponent(url.pathname); } catch { return new Response('Bad request', { status: 400 }); }
    if (path === '/_localized' || path.startsWith('/_localized/')) {
      return new Response('Not found', { status: 404 });
    }
    if (url.pathname === '/index.html' || url.pathname === '/app.html') {
      url.pathname = url.pathname === '/index.html' ? '/' : '/app';
      return Response.redirect(url.toString(), 308);
    }
    if (url.pathname !== '/' && url.pathname !== '/app') {
      // Human-readable provider/privacy pages have stable clean URLs.
      if ((path === '/impressum' || path === '/datenschutz') && (request.method === 'GET' || request.method === 'HEAD')) {
        url.pathname = path + '.html';
        return env.ASSETS.fetch(new Request(url, request));
      }
      const response = await env.ASSETS.fetch(request);
      if (response.status !== 404 || (request.method !== 'GET' && request.method !== 'HEAD')) return response;
      const errorUrl = new URL('/404.html', request.url);
      const errorPage = await env.ASSETS.fetch(new Request(errorUrl, { method: request.method }));
      if (!errorPage.ok) return new Response(request.method === 'HEAD' ? null : 'Not found', { status: 404 });
      const headers = new Headers(errorPage.headers);
      headers.set('Cache-Control', 'no-store');
      return new Response(request.method === 'HEAD' ? null : errorPage.body, { status: 404, headers });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    const requested = url.searchParams.get('lang');
    const lang = languages.has(requested) ? requested : 'de';
    url.pathname = '/_localized/' + lang + (url.pathname === '/' ? '/' : '/app');
    url.search = '';
    const response = await env.ASSETS.fetch(new Request(url, request));
    // A missing build is a deployment error, never silently serve a different language.
    if (response.status === 404) return new Response('Localized pages are not built', { status: 503, headers: { 'Cache-Control': 'no-store' } });
    return response;
  }
};
