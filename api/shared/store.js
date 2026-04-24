const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const defaultPlan = require("../seeds/current-plan.json");

let cachedStore;

function getStore() {
  if (cachedStore) return cachedStore;

  if (process.env.COSMOS_ENDPOINT) {
    cachedStore = createCosmosStore();
  } else {
    cachedStore = createFileStore();
  }

  return cachedStore;
}

function createFileStore() {
  const filePath = process.env.LOCAL_DB_PATH || path.resolve(process.cwd(), "data", "gym-checkin.local.json");

  async function readDb() {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      return normalizeDb(JSON.parse(raw));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { sessions: [], plans: [], settings: {} };
    }
  }

  async function writeDb(db) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(db, null, 2));
  }

  return {
    async listSessions(userId, limit = 100) {
      const db = await readDb();
      return db.sessions
        .filter((item) => item.userId === userId)
        .sort((a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date))
        .slice(0, limit);
    },

    async saveSession(userId, session) {
      const db = await readDb();
      const item = normalizeSession(userId, session);
      db.sessions = [item, ...db.sessions.filter((existing) => existing.id !== item.id)];
      await writeDb(db);
      return item;
    },

    async deleteSession(userId, id) {
      const db = await readDb();
      const before = db.sessions.length;
      db.sessions = db.sessions.filter((item) => !(item.userId === userId && item.id === id));
      await writeDb(db);
      return db.sessions.length !== before;
    },

    async getActivePlan(userId) {
      const db = await readDb();
      const activePlanId = db.settings[userId]?.activePlanId;
      const activePlan = db.plans.find((item) => item.userId === userId && item.id === activePlanId);
      return activePlan || { ...defaultPlan, userId };
    },

    async savePlan(userId, plan, makeActive = true) {
      const db = await readDb();
      db.plans ||= [];
      const item = normalizePlan(userId, plan);
      db.plans = [item, ...db.plans.filter((existing) => !(existing.userId === userId && existing.id === item.id))];
      if (makeActive) {
        db.settings[userId] = {
          ...(db.settings[userId] || { units: "lb" }),
          userId,
          activePlanId: item.id,
          updatedAt: new Date().toISOString()
        };
      }
      await writeDb(db);
      return item;
    },

    async listPlans(userId, limit = 20) {
      const db = await readDb();
      return (db.plans || [])
        .filter((item) => item.userId === userId)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, limit);
    },

    async getEquipmentProgress(userId, equipmentId, exerciseId, limit = 20) {
      const db = await readDb();
      return progressFromSessions(db.sessions.filter((item) => item.userId === userId), equipmentId, exerciseId, limit);
    },

    async getSettings(userId) {
      const db = await readDb();
      return db.settings[userId] || { units: "lb" };
    },

    async saveSettings(userId, settings) {
      const db = await readDb();
      db.settings[userId] = { userId, ...settings, updatedAt: new Date().toISOString() };
      await writeDb(db);
      return db.settings[userId];
    }
  };
}

function normalizeDb(db) {
  return {
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    plans: Array.isArray(db.plans) ? db.plans : [],
    settings: db.settings && typeof db.settings === "object" ? db.settings : {}
  };
}

function createCosmosStore() {
  const { CosmosClient } = require("@azure/cosmos");
  const { DefaultAzureCredential } = require("@azure/identity");
  const client = new CosmosClient({
    endpoint: process.env.COSMOS_ENDPOINT,
    aadCredentials: new DefaultAzureCredential()
  });

  const databaseId = process.env.COSMOS_DATABASE || "gymcheckin";
  const containerId = process.env.COSMOS_CONTAINER || "items";

  function container() {
    return client.database(databaseId).container(containerId);
  }

  return {
    async listSessions(userId, limit = 100) {
      const c = container();
      const query = {
        query: "SELECT * FROM c WHERE c.userId = @userId AND c.type = 'session' ORDER BY c.completedAt DESC OFFSET 0 LIMIT @limit",
        parameters: [
          { name: "@userId", value: userId },
          { name: "@limit", value: limit }
        ]
      };
      const { resources } = await c.items.query(query, { partitionKey: userId }).fetchAll();
      return resources;
    },

    async saveSession(userId, session) {
      const c = container();
      const item = normalizeSession(userId, session);
      await c.items.upsert(item);
      return item;
    },

    async deleteSession(userId, id) {
      const c = container();
      await c.item(id, userId).delete();
      return true;
    },

    async getActivePlan(userId) {
      const c = container();
      const settings = await this.getSettings(userId);
      if (settings.activePlanId) {
        try {
          const { resource } = await c.item(settings.activePlanId, userId).read();
          if (resource) return resource;
        } catch (error) {
          if (error.code !== 404) throw error;
        }
      }
      return { ...defaultPlan, userId };
    },

    async savePlan(userId, plan, makeActive = true) {
      const c = container();
      const item = normalizePlan(userId, plan);
      await c.items.upsert(item);
      if (makeActive) {
        const settings = await this.getSettings(userId);
        await this.saveSettings(userId, { ...settings, activePlanId: item.id });
      }
      return item;
    },

    async listPlans(userId, limit = 20) {
      const c = container();
      const query = {
        query: "SELECT * FROM c WHERE c.userId = @userId AND c.type = 'plan' ORDER BY c.updatedAt DESC OFFSET 0 LIMIT @limit",
        parameters: [
          { name: "@userId", value: userId },
          { name: "@limit", value: limit }
        ]
      };
      const { resources } = await c.items.query(query, { partitionKey: userId }).fetchAll();
      return resources;
    },

    async getEquipmentProgress(userId, equipmentId, exerciseId, limit = 20) {
      const c = container();
      const query = {
        query: "SELECT TOP @limit * FROM c WHERE c.userId = @userId AND c.type = 'session' ORDER BY c.completedAt DESC",
        parameters: [
          { name: "@userId", value: userId },
          { name: "@limit", value: 200 }
        ]
      };
      const { resources } = await c.items.query(query, { partitionKey: userId }).fetchAll();
      return progressFromSessions(resources, equipmentId, exerciseId, limit);
    },

    async getSettings(userId) {
      const c = container();
      try {
        const { resource } = await c.item(`settings:${userId}`, userId).read();
        return resource?.settings || { units: "lb" };
      } catch (error) {
        if (error.code === 404) return { units: "lb" };
        throw error;
      }
    },

    async saveSettings(userId, settings) {
      const c = container();
      const item = {
        id: `settings:${userId}`,
        type: "settings",
        userId,
        settings,
        updatedAt: new Date().toISOString()
      };
      await c.items.upsert(item);
      return settings;
    }
  };
}

function normalizeSession(userId, session) {
  const now = new Date().toISOString();
  return {
    ...session,
    id: session.id || crypto.randomUUID(),
    type: "session",
    userId,
    createdAt: session.createdAt || now,
    completedAt: session.completedAt || now
  };
}

function normalizePlan(userId, plan) {
  const now = new Date().toISOString();
  return {
    ...plan,
    id: plan.id || `plan:${crypto.randomUUID()}`,
    type: "plan",
    userId,
    createdAt: plan.createdAt || now,
    updatedAt: now
  };
}

function progressFromSessions(sessions, equipmentId, exerciseId, limit) {
  const rows = [];
  const sorted = [...sessions].sort((a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date));

  for (const session of sorted) {
    for (const exercise of session.exercises || []) {
      const equipmentMatches = !equipmentId || exercise.equipmentId === equipmentId;
      const exerciseMatches = !exerciseId || exercise.id === exerciseId;
      if (!equipmentMatches || !exerciseMatches) continue;

      const completedSets = (exercise.sets || []).filter((set) => set.done !== false && set.weight !== "");
      const topSet = completedSets
        .map((set) => ({
          weight: Number(set.weight),
          reps: Number(set.reps),
          rir: set.rir === "" ? null : Number(set.rir),
          set: set.set
        }))
        .filter((set) => Number.isFinite(set.weight))
        .sort((a, b) => b.weight - a.weight || b.reps - a.reps)[0];

      rows.push({
        sessionId: session.id,
        date: session.date,
        completedAt: session.completedAt,
        workoutId: session.workoutId,
        workoutName: session.workoutName,
        exerciseId: exercise.id,
        exerciseName: exercise.name,
        equipmentId: exercise.equipmentId,
        equipmentName: exercise.equipmentName,
        topSet,
        sets: completedSets
      });

      if (rows.length >= limit) return rows;
    }
  }

  return rows;
}

module.exports = { getStore };
