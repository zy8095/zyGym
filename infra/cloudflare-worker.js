const ORIGIN_HOST = "stzygymzy8095.z5.web.core.windows.net";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originUrl = new URL(request.url);
    originUrl.protocol = "https:";
    originUrl.hostname = ORIGIN_HOST;
    originUrl.port = "";

    const originRequest = new Request(originUrl.toString(), request);
    originRequest.headers.set("Host", ORIGIN_HOST);

    const response = await fetch(originRequest, {
      cf: {
        cacheEverything: request.method === "GET",
        cacheTtlByStatus: { "200-299": 300, 404: 30, "500-599": 0 }
      }
    });

    const headers = new Headers(response.headers);
    const location = headers.get("Location");
    if (location) {
      headers.set("Location", location.replace(`https://${ORIGIN_HOST}`, `${url.protocol}//${url.host}`));
    }

    headers.set("X-ZyGym-Origin", ORIGIN_HOST);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
