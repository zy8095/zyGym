const STATIC_ORIGIN_HOST = "stzygymzy8095.z5.web.core.windows.net";
const API_ORIGIN_HOST = "func-zygym-zy8095.azurewebsites.net";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isApi = url.pathname.startsWith("/api/") || url.pathname === "/.auth" || url.pathname.startsWith("/.auth/");
    const originHost = isApi ? API_ORIGIN_HOST : STATIC_ORIGIN_HOST;
    const originUrl = new URL(request.url);
    originUrl.protocol = "https:";
    originUrl.hostname = originHost;
    originUrl.port = "";

    const originRequest = new Request(originUrl.toString(), request);
    originRequest.headers.set("Host", originHost);

    const fetchOptions = isApi ? {} : {
      cf: {
        cacheEverything: request.method === "GET",
        cacheTtlByStatus: { "200-299": 300, 404: 30, "500-599": 0 }
      }
    };
    const response = await fetch(originRequest, fetchOptions);

    const headers = new Headers(response.headers);
    const location = headers.get("Location");
    if (location) {
      headers.set(
        "Location",
        location
          .replaceAll(`https://${originHost}`, `${url.protocol}//${url.host}`)
          .replaceAll(encodeURIComponent(`https://${originHost}`), encodeURIComponent(`${url.protocol}//${url.host}`))
      );
    }
    const setCookie = headers.get("Set-Cookie");
    if (setCookie && isApi) {
      headers.set("Set-Cookie", setCookie.replaceAll(`Domain=${originHost}`, `Domain=${url.hostname}`));
    }

    headers.set("X-ZyGym-Origin", originHost);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
