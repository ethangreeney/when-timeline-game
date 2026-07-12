const ORIGIN = "https://when-weird-neighbors.ethan447376.chatgpt.site";

function replaceOrigin(value, publicOrigin) {
  return value?.split(ORIGIN).join(publicOrigin) ?? value;
}

const worker = {
  async fetch(request) {
    const publicUrl = new URL(request.url);
    const upstreamUrl = new URL(`${publicUrl.pathname}${publicUrl.search}`, ORIGIN);
    const upstreamHeaders = new Headers(request.headers);

    upstreamHeaders.delete("cookie");
    upstreamHeaders.delete("host");
    upstreamHeaders.set("x-forwarded-host", publicUrl.host);
    upstreamHeaders.set("x-forwarded-proto", "https");

    const upstreamRequest = new Request(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    let upstreamResponse;

    try {
      upstreamResponse = await fetch(upstreamRequest);
    } catch {
      return new Response("WHEN? is briefly between moments. Please try again in a minute.", {
        status: 502,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const responseHeaders = new Headers(upstreamResponse.headers);

    responseHeaders.delete("set-cookie");

    for (const name of ["location", "link", "content-security-policy", "content-security-policy-report-only"]) {
      const value = responseHeaders.get(name);
      if (value) responseHeaders.set(name, replaceOrigin(value, publicUrl.origin));
    }

    responseHeaders.set("x-when-source", "codex-sites");

    const contentType = responseHeaders.get("content-type") ?? "";
    const shouldRewriteBody =
      contentType.includes("text/html") ||
      contentType.includes("text/x-component") ||
      contentType.includes("application/json");

    if (shouldRewriteBody && request.method !== "HEAD") {
      const body = replaceOrigin(await upstreamResponse.text(), publicUrl.origin);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      responseHeaders.delete("etag");
      responseHeaders.set("cache-control", "no-cache");

      return new Response(body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    }

    return new Response(request.method === "HEAD" ? null : upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  },
};

export default worker;
