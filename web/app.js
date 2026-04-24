const STORAGE_KEYS = {
  draft: "gym-checkin:draft",
  sessions: "gym-checkin:sessions",
  settings: "gym-checkin:settings",
  plan: "gym-checkin:plan"
};

const app = document.querySelector("#app");
const title = document.querySelector("#workoutTitle");
const todayLabel = document.querySelector("#todayLabel");
const syncButton = document.querySelector("#syncButton");
const tabs = [...document.querySelectorAll(".tab")];

const state = {
  route: "today",
  selectedPlan: "",
  sessions: [],
  settings: loadSettings(),
  draft: loadDraft(),
  equipment: {},
  plan: null,
  apiOnline: false
};

init();

async function init() {
  bindShell();
  renderLoading();
  await Promise.all([loadEquipment(), loadPlan(), loadRemoteSessions()]);
  state.selectedPlan = todayWorkoutId();
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  }
}

function bindShell() {
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.route = tab.dataset.route;
      render();
    });
  });

  syncButton.addEventListener("click", async () => {
    await Promise.all([loadPlan(true), loadRemoteSessions(true)]);
    toast(state.apiOnline ? "已同步 Cosmos/API" : "离线模式：使用本地缓存");
    render();
  });
}

async function loadEquipment() {
  const data = await fetchJson("/data/equipment.json");
  state.equipment = Object.fromEntries((data.items || []).map((item) => [item.id, item]));
}

async function loadPlan(showErrors = false) {
  try {
    const data = await fetchJson("/api/plans");
    state.plan = data.plan;
    state.apiOnline = true;
    localStorage.setItem(STORAGE_KEYS.plan, JSON.stringify(state.plan));
  } catch (error) {
    state.apiOnline = false;
    if (showErrors) console.warn(error);
    state.plan = readJson(STORAGE_KEYS.plan, null) || (await fetchJson("/data/plans/current.json"));
  }
}

async function loadRemoteSessions(showErrors = false) {
  try {
    const data = await fetchJson("/api/sessions?limit=200");
    state.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    state.apiOnline = true;
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessions));
  } catch (error) {
    state.apiOnline = false;
    state.sessions = loadLocalSessions();
    if (showErrors) console.warn(error);
  }
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function render() {
  const current = currentWorkout();
  const date = new Date();
  todayLabel.textContent = `${formatWeekday(date)} · ${formatDate(date)}`;
  title.textContent = state.route === "today" ? current.name : routeTitle(state.route);

  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.route === state.route));

  if (state.route === "today") renderToday();
  if (state.route === "plan") renderPlan();
  if (state.route === "history") renderHistory();
  if (state.route === "settings") renderSettings();
}

function renderLoading() {
  title.textContent = "Gym Check-in";
  app.innerHTML = `<section class="panel"><h2>加载中</h2><p class="muted">正在读取计划和器械资料。</p></section>`;
}

function renderToday() {
  const workout = currentWorkout();
  if (workout.kind === "strength") {
    renderStrength(workout, true);
    return;
  }

  app.innerHTML = `
    <section class="panel hero-card">
      <div>
        <p class="eyebrow">今日</p>
        <h2>${workout.name}</h2>
        <p class="muted">${workout.focus}</p>
      </div>
      <div class="metric-grid">
        <div class="metric"><strong>${state.sessions.length}</strong><span class="metric-label">记录</span></div>
        <div class="metric"><strong>${weeklyStrengthCount()}</strong><span class="metric-label">本周力量</span></div>
        <div class="metric"><strong>${state.apiOnline ? "云端" : "本地"}</strong><span class="metric-label">模式</span></div>
      </div>
    </section>
    <section class="panel">
      <h2>${workout.name}</h2>
      ${(workout.cues || []).map((cue) => `<p class="cue">${cue}</p>`).join("")}
      <div class="action-row">
        <button class="primary-button" type="button" data-save-simple="${workout.id}">完成打卡</button>
      </div>
    </section>
  `;

  app.querySelector("[data-save-simple]").addEventListener("click", () => saveSimpleWorkout(workout));
}

function renderStrength(workout, isToday = false) {
  const dateKey = todayKey();
  const draftKey = `${dateKey}:${state.plan.id}:${workout.id}`;
  const draft = state.draft[draftKey] || createDraft(workout);
  state.draft[draftKey] = draft;
  persistDraft();

  const visibleExercises = workout.exercises.filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
  const setCount = visibleExercises.reduce((sum, item) => sum + activeSetCount(item, draft.lowEnergy), 0);
  const completeCount = countCompleteSets(draft);
  const lastSame = state.sessions.find((session) => session.workoutId === workout.id);

  app.innerHTML = `
    <section class="panel hero-card">
      <div>
        <p class="eyebrow">${isToday ? "今日训练" : "计划预览"}</p>
        <h2>${workout.name}</h2>
        <p class="muted">${lastSame ? `上次：${formatDate(new Date(lastSame.completedAt || lastSame.date))}` : "还没有同类训练记录"}</p>
      </div>
      <div class="metric-grid">
        <div class="metric"><strong>${completeCount}</strong><span class="metric-label">已完成</span></div>
        <div class="metric"><strong>${setCount}</strong><span class="metric-label">目标组</span></div>
        <div class="metric"><strong>${draft.lowEnergy ? "开" : "关"}</strong><span class="metric-label">低疲劳</span></div>
      </div>
    </section>

    <section class="panel compact">
      <div class="pill-row">
        <button class="pill-button ${draft.lowEnergy ? "active" : ""}" type="button" data-low-energy>今天累</button>
        <button class="pill-button" type="button" data-fill-last>带入上次重量</button>
        <button class="pill-button" type="button" data-clear-draft>清空今天</button>
      </div>
    </section>

    <section>
      ${visibleExercises.map((item) => renderExercise(item, draft, workout.id)).join("")}
    </section>

    <section class="panel">
      <h2>备注</h2>
      <textarea class="note-box" id="sessionNotes" placeholder="状态、疼痛、器械排队、饮食都可以记">${escapeHtml(draft.notes || "")}</textarea>
      <div class="action-row">
        <button class="primary-button" type="button" data-finish-workout>完成训练</button>
      </div>
    </section>
  `;

  bindStrength(workout, draftKey);
}

function renderExercise(item, draft, workoutId) {
  const setTotal = activeSetCount(item, draft.lowEnergy);
  const rows = Array.from({ length: setTotal }, (_, index) => renderSetRow(item, draft, index)).join("");
  const note = progressionNote(item, workoutId);
  const equipment = equipmentFor(item.equipmentId);
  const alt = item.alternateEquipmentIds?.length ? ` / 替代：${item.alternateEquipmentIds.join(", ")}` : "";

  return `
    <article class="exercise-card" data-exercise="${item.id}" data-equipment="${item.equipmentId}">
      <div class="exercise-head">
        <img class="equipment-img" alt="${item.name}" src="${equipment.image}" loading="lazy" />
        <div>
          <div class="exercise-title-row">
            <div>
              <h3>${item.name}</h3>
              <p class="cue">${item.equipmentId} · ${equipment.name}${alt}</p>
            </div>
            <span class="target-badge">${setTotal} x ${item.repMin}-${item.repMax}</span>
          </div>
          <p class="cue">${item.cue}</p>
          <p class="progress-note">${note}</p>
        </div>
      </div>
      <div class="set-list">${rows}</div>
    </article>
  `;
}

function renderSetRow(item, draft, index) {
  const entry = ensureSetEntry(draft, item.id, index);
  return `
    <div class="set-row" data-exercise="${item.id}" data-set="${index}">
      <span class="set-number">${index + 1}</span>
      <label><span>重量</span><input inputmode="decimal" name="weight" placeholder="${state.settings.units}" value="${entry.weight ?? ""}" /></label>
      <label><span>次数</span><input inputmode="numeric" name="reps" placeholder="${item.repMax}" value="${entry.reps ?? ""}" /></label>
      <label><span>RIR</span><input inputmode="numeric" name="rir" placeholder="2" value="${entry.rir ?? ""}" /></label>
      <button class="check-button ${entry.done ? "done" : ""}" type="button" aria-label="完成这一组"></button>
    </div>
  `;
}

function bindStrength(workout, draftKey) {
  const draft = state.draft[draftKey];

  app.querySelector("[data-low-energy]").addEventListener("click", () => {
    draft.lowEnergy = !draft.lowEnergy;
    persistDraft();
    render();
  });

  app.querySelector("[data-clear-draft]").addEventListener("click", () => {
    state.draft[draftKey] = createDraft(workout);
    persistDraft();
    render();
  });

  app.querySelector("[data-fill-last]").addEventListener("click", () => {
    fillLastWeights(workout, draft);
    persistDraft();
    render();
    toast("已带入上次重量");
  });

  app.querySelectorAll(".set-row").forEach((row) => {
    const exerciseId = row.dataset.exercise;
    const setIndex = Number(row.dataset.set);
    const entry = ensureSetEntry(draft, exerciseId, setIndex);

    row.querySelectorAll("input").forEach((input) => {
      input.addEventListener("input", () => {
        entry[input.name] = input.value.trim();
        persistDraft();
      });
    });

    row.querySelector(".check-button").addEventListener("click", (event) => {
      entry.done = !entry.done;
      event.currentTarget.classList.toggle("done", entry.done);
      persistDraft();
      refreshTodayMetrics(workout, draft);
    });
  });

  app.querySelector("#sessionNotes").addEventListener("input", (event) => {
    draft.notes = event.target.value;
    persistDraft();
  });

  app.querySelector("[data-finish-workout]").addEventListener("click", () => finishWorkout(workout, draftKey));
}

function renderPlan() {
  const schedule = state.plan.schedule || [];
  app.innerHTML = `
    <section class="panel">
      <h2>${state.plan.name}</h2>
      <p class="muted">版本：${state.plan.version}</p>
      <div class="schedule">
        ${schedule.map((day) => `
          <button class="day-chip ${day.day === new Date().getDay() ? "active" : ""}" type="button" data-plan-day="${day.workoutId}">
            <span>周${day.short}</span>
            <strong>${day.label}</strong>
          </button>
        `).join("")}
      </div>
    </section>
    <section class="panel compact">
      <div class="pill-row">
        ${Object.values(state.plan.workouts).map((workout) => `
          <button class="pill-button ${state.selectedPlan === workout.id ? "active" : ""}" type="button" data-plan="${workout.id}">
            ${workout.name.split("：")[0]}
          </button>
        `).join("")}
      </div>
    </section>
    <div id="planPreview"></div>
  `;

  app.querySelectorAll("[data-plan], [data-plan-day]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedPlan = button.dataset.plan || button.dataset.planDay;
      renderPlan();
    });
  });

  const preview = app.querySelector("#planPreview");
  const workout = state.plan.workouts[state.selectedPlan] || currentWorkout();
  if (workout.kind === "strength") {
    preview.innerHTML = workout.exercises.map((item) => {
      const equipment = equipmentFor(item.equipmentId);
      return `
        <article class="exercise-card">
          <div class="exercise-head">
            <img class="equipment-img" alt="${item.name}" src="${equipment.image}" loading="lazy" />
            <div>
              <div class="exercise-title-row">
                <h3>${item.name}</h3>
                <span class="target-badge">${item.sets} x ${item.repMin}-${item.repMax}</span>
              </div>
              <p class="cue">${item.equipmentId} · ${equipment.name}</p>
              <p class="cue">${item.cue}</p>
            </div>
          </div>
        </article>
      `;
    }).join("");
  } else {
    preview.innerHTML = `
      <section class="panel">
        <h2>${workout.name}</h2>
        <p class="muted">${workout.focus}</p>
        ${(workout.cues || []).map((cue) => `<p class="cue">${cue}</p>`).join("")}
      </section>
    `;
  }
}

function renderHistory() {
  const sessions = [...state.sessions].sort((a, b) => new Date(b.completedAt || b.date) - new Date(a.completedAt || a.date));
  app.innerHTML = `
    <section class="panel hero-card">
      <div>
        <p class="eyebrow">历史</p>
        <h2>${sessions.length} 次记录</h2>
        <p class="muted">${state.apiOnline ? "Cosmos/API" : "本地缓存"}</p>
      </div>
      <div class="metric-grid">
        <div class="metric"><strong>${weeklyStrengthCount()}</strong><span class="metric-label">本周力量</span></div>
        <div class="metric"><strong>${sessions.filter((s) => s.kind === "cardio").length}</strong><span class="metric-label">有氧</span></div>
        <div class="metric"><strong>${sessions.filter((s) => s.kind === "mobility").length}</strong><span class="metric-label">普拉提</span></div>
      </div>
    </section>
    <section class="panel compact">
      <div class="action-row">
        <button class="secondary-button" type="button" data-export-json>导出 JSON</button>
        <button class="secondary-button" type="button" data-export-csv>导出 CSV</button>
      </div>
    </section>
    <section class="history-list">
      ${sessions.length ? sessions.slice(0, 30).map(renderHistoryCard).join("") : `<div class="panel"><p class="muted">还没有记录。</p></div>`}
    </section>
  `;

  app.querySelector("[data-export-json]").addEventListener("click", () => download("gym-sessions.json", JSON.stringify(sessions, null, 2), "application/json"));
  app.querySelector("[data-export-csv]").addEventListener("click", () => download("gym-sessions.csv", sessionsToCsv(sessions), "text/csv"));
}

function renderHistoryCard(session) {
  const date = formatDate(new Date(session.completedAt || session.date));
  const exercises = (session.exercises || []).slice(0, 5).map((item) => {
    const done = (item.sets || []).filter((set) => set.done).length;
    const topSet = topSetFor(item.sets || []);
    const topText = topSet ? ` · top ${topSet.weight} x ${topSet.reps}` : "";
    return `<li>${item.name} (${item.equipmentId || ""}): ${done} 组${topText}</li>`;
  }).join("");

  return `
    <article class="history-card">
      <header>
        <strong>${session.workoutName}</strong>
        <span class="tiny muted">${date}</span>
      </header>
      ${exercises ? `<ul>${exercises}</ul>` : `<p class="cue">${session.focus || "完成打卡"}</p>`}
      ${session.notes ? `<p class="cue">${escapeHtml(session.notes)}</p>` : ""}
    </article>
  `;
}

function renderSettings() {
  app.innerHTML = `
    <section class="panel">
      <h2>设置</h2>
      <div class="settings-grid two">
        <label>
          单位
          <select id="unitSelect">
            <option value="lb" ${state.settings.units === "lb" ? "selected" : ""}>lb</option>
            <option value="kg" ${state.settings.units === "kg" ? "selected" : ""}>kg</option>
          </select>
        </label>
        <label>
          API 状态
          <input value="${state.apiOnline ? "online" : "local"}" readonly />
        </label>
      </div>
      <div class="action-row">
        <button class="secondary-button" type="button" data-save-settings>保存</button>
        <button class="secondary-button" type="button" data-push-plan>把当前计划写入后端</button>
        <button class="danger-button" type="button" data-clear-local>清空本地缓存</button>
      </div>
    </section>
    <section class="panel">
      <h2>数据模型</h2>
      <p class="cue">器械和图片是静态资源；每周计划、打卡 session、设置存在 API/Cosmos。</p>
      <p class="cue">当前计划：${state.plan.id} · ${state.plan.version}</p>
    </section>
  `;

  app.querySelector("[data-save-settings]").addEventListener("click", async () => {
    state.settings.units = app.querySelector("#unitSelect").value;
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    await saveSettings(state.settings);
    toast("设置已保存");
  });

  app.querySelector("[data-push-plan]").addEventListener("click", async () => {
    await savePlan(state.plan);
    toast("当前计划已写入后端");
  });

  app.querySelector("[data-clear-local]").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.draft);
    localStorage.removeItem(STORAGE_KEYS.sessions);
    state.draft = {};
    state.sessions = [];
    toast("本地缓存已清空");
    render();
  });
}

async function finishWorkout(workout, draftKey) {
  const draft = state.draft[draftKey];
  const session = {
    planId: state.plan.id,
    planVersion: state.plan.version,
    workoutId: workout.id,
    workoutName: workout.name,
    kind: workout.kind,
    date: todayKey(),
    completedAt: new Date().toISOString(),
    lowEnergy: Boolean(draft.lowEnergy),
    notes: draft.notes || "",
    exercises: workout.exercises
      .filter((item) => activeSetCount(item, draft.lowEnergy) > 0)
      .map((item) => {
        const equipment = equipmentFor(item.equipmentId);
        return {
          id: item.id,
          name: item.name,
          equipmentId: item.equipmentId,
          equipmentName: equipment.name,
          sets: (draft.exercises[item.id] || []).slice(0, activeSetCount(item, draft.lowEnergy)).map((set, index) => ({
            set: index + 1,
            weight: set.weight || "",
            reps: set.reps || "",
            rir: set.rir || "",
            done: Boolean(set.done)
          }))
        };
      })
  };

  await saveSession(session);
  delete state.draft[draftKey];
  persistDraft();
  await loadRemoteSessions();
  toast("训练已记录");
  render();
}

async function saveSimpleWorkout(workout) {
  const session = {
    planId: state.plan.id,
    planVersion: state.plan.version,
    workoutId: workout.id,
    workoutName: workout.name,
    kind: workout.kind,
    focus: workout.focus,
    date: todayKey(),
    completedAt: new Date().toISOString(),
    exercises: [],
    notes: ""
  };
  await saveSession(session);
  await loadRemoteSessions();
  toast("已打卡");
  render();
}

async function saveSession(session) {
  try {
    await fetchJson("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session)
    });
    state.apiOnline = true;
  } catch {
    state.apiOnline = false;
    const local = loadLocalSessions();
    local.unshift({ ...session, id: crypto.randomUUID(), savedLocalOnly: true });
    state.sessions = local;
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(local));
  }
}

async function savePlan(plan) {
  try {
    const data = await fetchJson("/api/plans", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan)
    });
    state.plan = data.plan;
    state.apiOnline = true;
    localStorage.setItem(STORAGE_KEYS.plan, JSON.stringify(state.plan));
  } catch {
    state.apiOnline = false;
    localStorage.setItem(STORAGE_KEYS.plan, JSON.stringify(plan));
  }
}

async function saveSettings(settings) {
  try {
    await fetchJson("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings)
    });
  } catch {
    state.apiOnline = false;
  }
}

function createDraft(workout) {
  const exercises = {};
  workout.exercises.forEach((item) => {
    exercises[item.id] = Array.from({ length: item.sets }, () => ({ weight: "", reps: "", rir: "", done: false }));
  });
  return { workoutId: workout.id, lowEnergy: false, notes: "", exercises };
}

function ensureSetEntry(draft, exerciseId, index) {
  draft.exercises[exerciseId] ||= [];
  draft.exercises[exerciseId][index] ||= { weight: "", reps: "", rir: "", done: false };
  return draft.exercises[exerciseId][index];
}

function activeSetCount(item, lowEnergy) {
  if (!lowEnergy) return item.sets;
  if (item.priority === "main") return item.sets;
  if (item.priority === "support") return Math.min(item.sets, 2);
  return 0;
}

function countCompleteSets(draft) {
  return Object.values(draft.exercises).flat().filter((set) => set?.done).length;
}

function refreshTodayMetrics(workout, draft) {
  const metrics = app.querySelectorAll(".metric strong");
  const visibleExercises = workout.exercises.filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
  if (metrics[0]) metrics[0].textContent = countCompleteSets(draft);
  if (metrics[1]) metrics[1].textContent = visibleExercises.reduce((sum, item) => sum + activeSetCount(item, draft.lowEnergy), 0);
}

function fillLastWeights(workout, draft) {
  workout.exercises.forEach((item) => {
    const last = latestExercise(item.id, item.equipmentId, workout.id);
    if (!last) return;
    (last.sets || []).forEach((set, index) => {
      const entry = ensureSetEntry(draft, item.id, index);
      entry.weight = set.weight || entry.weight || "";
    });
  });
}

function progressionNote(item, workoutId) {
  const last = latestExercise(item.id, item.equipmentId, workoutId);
  if (!last) return "首次记录：先找稳定重量";

  const topSet = topSetFor(last.sets || []);
  const doneSets = (last.sets || []).filter((set) => set.done);
  const topText = topSet ? `上次这台 ${topSet.weight} x ${topSet.reps}` : "上次已记录";
  const allTop = doneSets.length >= item.sets && doneSets.every((set) => Number(set.reps) >= item.repMax);
  return allTop ? `${topText} · 下次加一档` : `${topText} · 先补次数`;
}

function latestExercise(exerciseId, equipmentId, workoutId) {
  const session = state.sessions.find((item) =>
    item.workoutId === workoutId &&
    (item.exercises || []).some((exerciseItem) => exerciseItem.id === exerciseId && exerciseItem.equipmentId === equipmentId)
  );
  return session?.exercises?.find((item) => item.id === exerciseId && item.equipmentId === equipmentId);
}

function topSetFor(sets) {
  return sets
    .filter((set) => set.done && set.weight !== "")
    .map((set) => ({ weight: Number(set.weight), reps: Number(set.reps), rir: set.rir === "" ? null : Number(set.rir), set: set.set }))
    .filter((set) => Number.isFinite(set.weight))
    .sort((a, b) => b.weight - a.weight || b.reps - a.reps)[0];
}

function weeklyStrengthCount() {
  const start = startOfWeek(new Date());
  return state.sessions.filter((session) => session.kind === "strength" && new Date(session.completedAt || session.date) >= start).length;
}

function equipmentFor(id) {
  return state.equipment[id] || { id, name: id, label: id, image: "/assets/icon.svg" };
}

function currentWorkout() {
  const id = todayWorkoutId();
  return state.plan?.workouts?.[id] || state.plan?.workouts?.rest || { id: "rest", name: "休息", kind: "rest", focus: "恢复", cues: [] };
}

function todayWorkoutId() {
  const day = new Date().getDay();
  return state.plan?.schedule?.find((item) => item.day === day)?.workoutId || "rest";
}

function todayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

function formatWeekday(date) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(date);
}

function startOfWeek(date) {
  const copy = new Date(date);
  const diff = (copy.getDay() + 6) % 7;
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - diff);
  return copy;
}

function routeTitle(route) {
  return { today: "今日", plan: "训练计划", history: "历史记录", settings: "设置" }[route] || "Gym Check-in";
}

function loadDraft() {
  return readJson(STORAGE_KEYS.draft, {});
}

function persistDraft() {
  localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(state.draft));
}

function loadLocalSessions() {
  return readJson(STORAGE_KEYS.sessions, []);
}

function loadSettings() {
  return { units: "lb", ...readJson(STORAGE_KEYS.settings, {}) };
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function sessionsToCsv(sessions) {
  const rows = [["date", "planId", "workout", "exercise", "equipmentId", "set", "weight", "reps", "rir", "done"]];
  sessions.forEach((session) => {
    if (!session.exercises?.length) {
      rows.push([session.date, session.planId, session.workoutName, "", "", "", "", "", "", "true"]);
    }
    session.exercises?.forEach((exerciseItem) => {
      exerciseItem.sets?.forEach((set) => {
        rows.push([session.date, session.planId, session.workoutName, exerciseItem.name, exerciseItem.equipmentId, set.set, set.weight, set.reps, set.rir, set.done]);
      });
    });
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toast(message) {
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 2200);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
