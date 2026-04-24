function getUserId(req) {
  const headers = normalizeHeaders(req.headers || {});
  const encodedPrincipal = headers["x-ms-client-principal"];
  if (encodedPrincipal) {
    try {
      const json = Buffer.from(encodedPrincipal, "base64").toString("utf8");
      const principal = JSON.parse(json);
      return principal.userId || principal.userDetails || "azure-user";
    } catch {
      return "azure-user";
    }
  }

  return headers["x-user-id"] || "local-user";
}

function normalizeHeaders(headers) {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});
}

module.exports = { getUserId };
