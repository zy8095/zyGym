const { json, readBody, getQuery } = require("./http");
const { getStore } = require("./store");
const { getDisplayUser, getUser } = require("./user");

async function sessionsHandler(req) {
  const auth = requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.userId;
  const store = getStore();

  if (req.method === "GET") {
    const limit = clamp(Number(getQuery(req, "limit", 100)) || 100, 1, 500);
    const sessions = await store.listSessions(userId, limit);
    return json(200, { sessions });
  }

  if (req.method === "POST") {
    const body = readBody(req);
    if (!body.workoutId || !body.workoutName) {
      return json(400, { error: "workoutId and workoutName are required" });
    }
    const session = await store.saveSession(userId, body);
    return json(201, { session });
  }

  if (req.method === "DELETE") {
    const id = getQuery(req, "id");
    if (!id) return json(400, { error: "id is required" });
    const deleted = await store.deleteSession(userId, id);
    return json(deleted ? 200 : 404, { deleted });
  }

  return json(405, { error: "method not allowed" });
}

async function plansHandler(req) {
  const auth = requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.userId;
  const store = getStore();

  if (req.method === "GET") {
    const mode = getQuery(req, "mode", "active");
    if (mode === "list") {
      const limit = clamp(Number(getQuery(req, "limit", 20)) || 20, 1, 100);
      const plans = await store.listPlans(userId, limit);
      return json(200, { plans });
    }
    const plan = await store.getActivePlan(userId);
    return json(200, { plan });
  }

  if (req.method === "POST" || req.method === "PUT") {
    const body = readBody(req);
    if (!body.id || !body.workouts || !body.schedule) {
      return json(400, { error: "plan id, schedule, and workouts are required" });
    }
    const makeActive = getQuery(req, "active", "true") !== "false";
    const plan = await store.savePlan(userId, body, makeActive);
    return json(200, { plan });
  }

  return json(405, { error: "method not allowed" });
}

async function progressHandler(req) {
  const auth = requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.userId;
  const store = getStore();
  const equipmentId = getQuery(req, "equipmentId");
  const exerciseId = getQuery(req, "exerciseId");
  const limit = clamp(Number(getQuery(req, "limit", 20)) || 20, 1, 100);

  if (!equipmentId && !exerciseId) {
    return json(400, { error: "equipmentId or exerciseId is required" });
  }

  const progress = await store.getEquipmentProgress(userId, equipmentId, exerciseId, limit);
  return json(200, { progress });
}

async function equipmentHandler(req) {
  const auth = requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.userId;
  const store = getStore();

  if (req.method === "GET") {
    const equipment = await store.getEquipment(userId);
    return json(200, { equipment });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = readBody(req);
    if (!Array.isArray(body?.items)) {
      return json(400, { error: "equipment items are required" });
    }
    const equipment = await store.saveEquipment(userId, body);
    return json(200, { equipment });
  }

  return json(405, { error: "method not allowed" });
}

async function settingsHandler(req) {
  const auth = requireUser(req);
  if (auth.response) return auth.response;
  const userId = auth.userId;
  const store = getStore();

  if (req.method === "GET") {
    const settings = await store.getSettings(userId);
    return json(200, { settings });
  }

  if (req.method === "PUT" || req.method === "POST") {
    const body = readBody(req);
    const settings = await store.saveSettings(userId, body);
    return json(200, { settings });
  }

  return json(405, { error: "method not allowed" });
}

async function meHandler(req) {
  return json(200, { authRequired: isAuthRequired(), user: getDisplayUser(req) });
}

async function healthHandler() {
  const hasCosmos = Boolean(process.env.COSMOS_ENDPOINT);
  return json(200, {
    ok: true,
    store: hasCosmos ? "cosmos" : "file",
    timestamp: new Date().toISOString()
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function requireUser(req) {
  const user = getUser(req);
  if (user?.id) return { userId: user.id, user };
  if (!isAuthRequired()) {
    return {
      userId: "local-user",
      user: { id: "local-user", name: "Local User", provider: "local", authenticated: false }
    };
  }
  return { response: json(401, { error: "login required" }) };
}

function isAuthRequired() {
  return String(process.env.AUTH_REQUIRED || "").toLowerCase() === "true";
}

module.exports = { sessionsHandler, plansHandler, progressHandler, equipmentHandler, settingsHandler, meHandler, healthHandler };
