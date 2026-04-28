const crypto = require("crypto");

const DEFAULT_AAD_CLIENT_ID = "e5b9f8d7-d88a-4bf8-aa85-cd2f53a39e6b";
const JWKS_URL = "https://login.microsoftonline.com/common/discovery/v2.0/keys";
let jwksCache = { expiresAt: 0, keys: [] };

async function getUser(req) {
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

  const bearer = bearerToken(headers.authorization);
  if (bearer) {
    const user = await getBearerUser(bearer);
    if (user) return user;
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

async function getUserId(req) {
  const user = await getUser(req);
  if (user?.id) return user.id;
  return "local-user";
}

async function getDisplayUser(req) {
  return (await getUser(req)) || {
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

function bearerToken(value = "") {
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getBearerUser(token) {
  try {
    const payload = await verifyMicrosoftIdToken(token);
    return {
      id: payload.oid || payload.sub,
      name: payload.name || payload.preferred_username || payload.email || "Microsoft user",
      provider: "aad-token",
      authenticated: true,
      roles: []
    };
  } catch {
    return null;
  }
}

async function verifyMicrosoftIdToken(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid token");

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  const expectedAudience = process.env.AAD_CLIENT_ID || DEFAULT_AAD_CLIENT_ID;
  const now = Math.floor(Date.now() / 1000);

  if (payload.aud !== expectedAudience) throw new Error("invalid audience");
  if (payload.exp && payload.exp < now) throw new Error("expired token");
  if (payload.nbf && payload.nbf > now + 60) throw new Error("token not active");
  if (!String(payload.iss || "").startsWith("https://login.microsoftonline.com/")) throw new Error("invalid issuer");

  const key = (await getJwks()).find((item) => item.kid === header.kid);
  if (!key) throw new Error("missing key");
  const publicKey = crypto.createPublicKey({ key, format: "jwk" });
  const verified = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], "base64url")
  );
  if (!verified) throw new Error("invalid signature");
  return payload;
}

async function getJwks() {
  if (jwksCache.expiresAt > Date.now() && jwksCache.keys.length) return jwksCache.keys;
  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("jwks fetch failed");
  const data = await response.json();
  jwksCache = {
    expiresAt: Date.now() + 60 * 60 * 1000,
    keys: Array.isArray(data.keys) ? data.keys : []
  };
  return jwksCache.keys;
}

module.exports = { getUser, getUserId, getDisplayUser };
