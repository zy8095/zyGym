function getUser(req) {
  const headers = normalizeHeaders(req.headers || {});
  const encodedPrincipal = headers["x-ms-client-principal"];
  if (encodedPrincipal) {
    try {
      const json = Buffer.from(encodedPrincipal, "base64").toString("utf8");
      const principal = JSON.parse(json);
      return {
        id: principal.userId || principal.userDetails || "azure-user",
        name: principal.userDetails || headers["x-ms-client-principal-name"] || "Microsoft user",
        provider: principal.identityProvider || "aad",
        authenticated: true,
        roles: Array.isArray(principal.userRoles) ? principal.userRoles : []
      };
    } catch {
      return {
        id: "azure-user",
        name: headers["x-ms-client-principal-name"] || "Microsoft user",
        provider: "aad",
        authenticated: true,
        roles: []
      };
    }
  }

  if (headers["x-user-id"]) {
    return {
      id: headers["x-user-id"],
      name: headers["x-user-name"] || headers["x-user-id"],
      provider: "dev-header",
      authenticated: false,
      roles: []
    };
  }

  return null;
}

function getUserId(req) {
  const user = getUser(req);
  if (user?.id) return user.id;
  return "local-user";
}

function getDisplayUser(req) {
  return getUser(req) || {
    id: "local-user",
    name: "Local User",
    provider: "local",
    authenticated: false,
    roles: []
  };
}

function normalizeHeaders(headers) {
  return Object.entries(headers).reduce((acc, [key, value]) => {
    acc[String(key).toLowerCase()] = value;
    return acc;
  }, {});
}

module.exports = { getUser, getUserId, getDisplayUser };
