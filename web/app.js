const STORAGE_KEYS = {
  draft: "gym-checkin:draft",
  sessions: "gym-checkin:sessions",
  settings: "gym-checkin:settings",
  plan: "gym-checkin:plan",
  equipment: "gym-checkin:equipment"
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
  equipmentProfile: { items: [] },
  editingEquipmentId: "",
  plan: null,
  user: null,
  config: { apiBaseUrl: "", useCredentials: false, requireAuth: false },
  apiOnline: false
};

init();

async function init() {
  bindShell();
  renderLoading();
  await loadConfig();
  await Promise.all([loadUser(), loadEquipment(), loadPlan(), loadRemoteSessions()]);
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

  app.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-zoom-image]");
    if (!trigger) return;
    openImageZoom(trigger.dataset.zoomImage, trigger.dataset.zoomTitle || trigger.alt || "器械图片");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeImageZoom();
  });
}

async function loadEquipment() {
  try {
    const data = await fetchJson(apiUrl("/equipment"));
    applyEquipmentProfile(data.equipment);
    localStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(state.equipmentProfile));
    state.apiOnline = true;
  } catch {
    const cached = readJson(STORAGE_KEYS.equipment, null);
    if (cached?.items?.length) {
      applyEquipmentProfile(cached);
      return;
    }
    const data = await fetchJson("/data/equipment.json");
    applyEquipmentProfile(data);
  }
}

async function loadUser() {
  try {
    const data = await fetchJson(apiUrl("/me"));
    state.user = { ...data.user, authRequired: Boolean(data.authRequired) };
  } catch {
    state.user = { id: "local-user", name: "Local User", provider: "local", authenticated: false, authRequired: state.config.requireAuth };
  }
}

function applyEquipmentProfile(profile) {
  const items = Array.isArray(profile?.items) ? profile.items : [];
  state.equipmentProfile = { ...profile, items };
  state.equipment = Object.fromEntries(items.map((item) => [item.id, item]));
}

async function loadConfig() {
  try {
    state.config = { ...state.config, ...(await fetchJson("/config.json")) };
  } catch {
    state.config = { apiBaseUrl: "" };
  }
}

async function loadPlan(showErrors = false) {
  try {
    const data = await fetchJson(apiUrl("/plans"));
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
    const data = await fetchJson(apiUrl("/sessions?limit=200"));
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
  const target = new URL(url, window.location.href);
  const fetchOptions = { ...(options || {}) };
  if (target.origin === window.location.origin || state.config.useCredentials) {
    fetchOptions.credentials = "include";
  }
  const res = await fetch(url, fetchOptions);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

function render() {
  const date = new Date();
  todayLabel.textContent = `${formatWeekday(date)} · ${formatDate(date)}`;
  const shouldShowLogin = loginRequired() && !state.user?.authenticated;
  document.body.classList.toggle("login-mode", shouldShowLogin);

  if (shouldShowLogin) {
    title.textContent = "登录";
    tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.route === "settings"));
    renderLoginGate();
    return;
  }

  const current = currentWorkout();
  title.textContent = state.route === "today" ? current.name : routeTitle(state.route);

  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.route === state.route));

  if (state.route === "today") renderToday();
  if (state.route === "equipment") renderEquipment();
  if (state.route === "plan") renderPlan();
  if (state.route === "history") renderHistory();
  if (state.route === "settings") renderSettings();
}

function renderLoginGate() {
  const workout = currentWorkout();
  const isStrength = workout.kind === "strength";
  const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
  const exerciseCount = isStrength ? exercises.length : 0;
  const setCount = isStrength ? exercises.reduce((sum, item) => sum + item.sets, 0) : 0;
  app.innerHTML = `
    <section class="login-screen">
      <div class="login-hero">
        <img src="/assets/login-hero.svg" alt="" />
        <div class="login-topline">
          <div class="login-brand"><span>zy</span>Gym</div>
          <div class="login-live">今天 · ${escapeHtml(workout.name)}</div>
        </div>
        <div class="login-caption">
          <span>${formatWeekday(new Date())}</span>
          <span>${isStrength ? `${exerciseCount} 项 · ${setCount} 组` : escapeHtml(workout.focus || "恢复")}</span>
        </div>
      </div>

      <div class="login-panel">
        <div class="login-handle"></div>
        <p class="eyebrow">zyGym</p>
        <h2>回到训练</h2>
        <p class="login-copy">登录后继续今天的计划、器械偏好和重量记录。</p>

        <div class="login-status-grid">
          <div class="login-status">
            <span>本周力量</span>
            <strong>${weeklyStrengthCount()}</strong>
          </div>
          <div class="login-status">
            <span>历史记录</span>
            <strong>${state.sessions.length}</strong>
          </div>
        </div>

        <button class="login-button" type="button" data-login>
          <span class="ms-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <span>使用 Microsoft 继续</span>
        </button>

        <p class="login-footnote">计划、记录和器械偏好只属于你</p>
      </div>
    </section>
  `;

  app.querySelector("[data-login]").addEventListener("click", () => {
    window.location.href = loginUrl();
  });
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
  ensureDraftShape(draft);
  state.draft[draftKey] = draft;
  persistDraft();

  if (isToday) {
    renderStrengthDeck(workout, draftKey);
    return;
  }

  const visibleExercises = orderedExercises(workoutExercises(workout, draft), draft).filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
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

function renderStrengthDeck(workout, draftKey) {
  const draft = state.draft[draftKey];
  const visibleExercises = orderedExercises(workoutExercises(workout, draft), draft).filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
  const setCount = visibleExercises.reduce((sum, item) => sum + activeSetCount(item, draft.lowEnergy), 0);
  const completeCount = countVisibleCompleteSets(visibleExercises, draft);
  const lastSame = state.sessions.find((session) => session.workoutId === workout.id);
  const current = activeDeckExercise(visibleExercises, draft);

  if (!current) {
    app.innerHTML = `<section class="panel"><h2>今天没有力量项目</h2><p class="muted">可以休息或者做 Zone 2。</p></section>`;
    return;
  }

  const actualEquipmentId = currentEquipmentId(current, draft);
  const equipment = equipmentFor(actualEquipmentId);
  const planned = equipmentFor(current.equipmentId);
  const meta = exerciseMeta(draft, current.id);
  const setTotal = activeSetCount(current, draft.lowEnergy);
  const setIndex = currentSetIndex(current, draft);
  const entry = ensureSetEntry(draft, current.id, setIndex);
  const doneForExercise = completeSetsForExercise(current, draft);
  const options = replacementOptions(current, actualEquipmentId);
  const note = progressionNote(current, workout.id, actualEquipmentId);

  app.innerHTML = `
    <section class="panel hero-card">
      <div>
        <p class="eyebrow">今日训练</p>
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

    <article class="deck-card ${meta.deferred ? "deferred" : ""}">
      <div class="deck-media">
        <img alt="${current.name}" src="${equipment.image}" data-zoom-image="${equipment.image}" data-zoom-title="${escapeHtml(current.name)}" />
        <span class="target-badge">${doneForExercise}/${setTotal} 组</span>
      </div>
      <div class="deck-body">
        <p class="eyebrow">${actualEquipmentId}${actualEquipmentId !== current.equipmentId ? ` · 原 ${planned.label || planned.name}` : ""}</p>
        <h2>${current.name}</h2>
        <p class="cue">${equipment.name}</p>
        <p class="cue">${current.cue}</p>
        <p class="progress-note">${note}</p>

        <div class="deck-set-row" data-exercise="${current.id}" data-set="${setIndex}">
          <span class="set-number">${setIndex + 1}</span>
          <label><span>重量</span><input inputmode="decimal" name="weight" placeholder="${state.settings.units}" value="${entry.weight ?? ""}" /></label>
          <label><span>次数</span><input inputmode="numeric" name="reps" placeholder="${current.repMax}" value="${entry.reps ?? ""}" /></label>
          <label><span>RIR</span><input inputmode="numeric" name="rir" placeholder="2" value="${entry.rir ?? ""}" /></label>
        </div>

        <div class="deck-actions">
          <button class="primary-button" type="button" data-complete-current>完成这一组</button>
          <button class="secondary-button" type="button" data-next-current>先去下个</button>
          <button class="secondary-button" type="button" data-replace-current>换机器</button>
          <button class="secondary-button" type="button" data-issue-current>有问题</button>
          <button class="secondary-button" type="button" data-add-exercise>加项目</button>
        </div>

        ${meta.showIssue ? renderIssuePanel(current) : ""}
        ${meta.choosingReplacement ? renderReplacementPanel(current, actualEquipmentId, options) : ""}
        ${draft.addingExercise ? renderAddExercisePanel() : ""}
      </div>
    </article>

    <section class="panel compact">
      <div class="queue-list">
        ${visibleExercises.map((item) => renderQueueItem(item, draft)).join("")}
      </div>
    </section>

    <section class="panel">
      <h2>备注</h2>
      <textarea class="note-box" id="sessionNotes" placeholder="状态、疼痛、器械排队、饮食都可以记">${escapeHtml(draft.notes || "")}</textarea>
      <div class="action-row">
        <button class="primary-button" type="button" data-finish-workout>完成训练</button>
      </div>
    </section>
  `;

  bindDeckStrength(workout, draftKey, current, setIndex);
}

function renderIssuePanel(item) {
  return `
    <div class="issue-panel">
      <button type="button" data-issue-action="${item.id}:busy">机器被占</button>
      <button type="button" data-issue-action="${item.id}:broken">机器坏了</button>
      <button type="button" data-issue-action="${item.id}:pain">不舒服</button>
      <button type="button" data-issue-action="${item.id}:tired">今天太累</button>
    </div>
  `;
}

function renderAddExercisePanel() {
  const items = equipmentItems().filter((item) => item.status !== "broken" && item.status !== "avoid");
  return `
    <div class="add-exercise-panel" data-add-exercise-panel>
      <label>
        机器
        <select name="equipmentId">
          ${items.map((item) => `<option value="${item.id}">${item.label || item.name}</option>`).join("")}
        </select>
      </label>
      <label>
        动作名
        <input name="name" placeholder="不填就用机器名" />
      </label>
      <div class="settings-grid three">
        <label>组数<input inputmode="numeric" name="sets" value="2" /></label>
        <label>最少<input inputmode="numeric" name="repMin" value="10" /></label>
        <label>最多<input inputmode="numeric" name="repMax" value="12" /></label>
      </div>
      <p class="cue">临时加项只记录到今天，默认 2 组就好，留 2-3 次余力。</p>
      <div class="action-row">
        <button class="secondary-button" type="button" data-save-extra-exercise>添加到今天</button>
        <button class="secondary-button" type="button" data-cancel-extra-exercise>取消</button>
      </div>
    </div>
  `;
}

function renderQueueItem(item, draft) {
  const setTotal = activeSetCount(item, draft.lowEnergy);
  const done = completeSetsForExercise(item, draft);
  const meta = exerciseMeta(draft, item.id);
  const active = draft.activeExerciseId === item.id || (!draft.activeExerciseId && done < setTotal);
  return `
    <button class="queue-item ${active ? "active" : ""} ${done >= setTotal ? "done" : ""}" type="button" data-focus-exercise="${item.id}">
      <span>${item.name}</span>
      <strong>${done}/${setTotal}</strong>
      ${item.adHoc ? "<small>加项</small>" : meta.deferred ? "<small>稍后</small>" : ""}
    </button>
  `;
}

function bindDeckStrength(workout, draftKey, current, setIndex) {
  const draft = state.draft[draftKey];
  const entry = ensureSetEntry(draft, current.id, setIndex);

  app.querySelector("[data-low-energy]").addEventListener("click", () => {
    draft.lowEnergy = !draft.lowEnergy;
    draft.activeExerciseId = "";
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

  app.querySelectorAll(".deck-set-row input").forEach((input) => {
    input.addEventListener("input", () => {
      entry[input.name] = input.value.trim();
      persistDraft();
    });
  });

  app.querySelector("[data-complete-current]").addEventListener("click", () => {
    app.querySelectorAll(".deck-set-row input").forEach((input) => {
      entry[input.name] = input.value.trim();
    });
    entry.done = true;
    if (completeSetsForExercise(current, draft) >= activeSetCount(current, draft.lowEnergy)) {
      focusNextExercise(workout, draft, current);
    } else {
      draft.activeExerciseId = current.id;
    }
    persistDraft();
    render();
  });

  app.querySelector("[data-next-current]").addEventListener("click", () => {
    const meta = exerciseMeta(draft, current.id);
    meta.deferred = true;
    meta.showIssue = false;
    meta.choosingReplacement = false;
    focusNextExercise(workout, draft, current);
    persistDraft();
    render();
  });

  app.querySelector("[data-replace-current]").addEventListener("click", () => {
    const meta = exerciseMeta(draft, current.id);
    meta.choosingReplacement = !meta.choosingReplacement;
    meta.showIssue = false;
    draft.addingExercise = false;
    persistDraft();
    render();
  });

  app.querySelector("[data-issue-current]").addEventListener("click", () => {
    const meta = exerciseMeta(draft, current.id);
    meta.showIssue = !meta.showIssue;
    meta.choosingReplacement = false;
    draft.addingExercise = false;
    persistDraft();
    render();
  });

  app.querySelector("[data-add-exercise]").addEventListener("click", () => {
    const meta = exerciseMeta(draft, current.id);
    draft.addingExercise = !draft.addingExercise;
    meta.showIssue = false;
    meta.choosingReplacement = false;
    persistDraft();
    render();
  });

  app.querySelector("[data-cancel-extra-exercise]")?.addEventListener("click", () => {
    draft.addingExercise = false;
    persistDraft();
    render();
  });

  app.querySelector("[data-save-extra-exercise]")?.addEventListener("click", () => {
    addExtraExerciseFromPanel(draft);
    persistDraft();
    render();
  });

  app.querySelectorAll("[data-issue-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const [exerciseId, action] = button.dataset.issueAction.split(":");
      handleIssueAction(workout, draft, exerciseId, action);
      persistDraft();
      render();
    });
  });

  app.querySelectorAll("[data-replacement]").forEach((button) => {
    button.addEventListener("click", () => {
      const [exerciseId, equipmentId] = button.dataset.replacement.split(":");
      const meta = exerciseMeta(draft, exerciseId);
      meta.equipmentId = equipmentId;
      meta.deferred = false;
      meta.choosingReplacement = false;
      meta.showIssue = false;
      draft.activeExerciseId = exerciseId;
      persistDraft();
      render();
      toast(`已换到 ${equipmentFor(equipmentId).label || equipmentId}`);
    });
  });

  app.querySelectorAll("[data-focus-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      draft.activeExerciseId = button.dataset.focusExercise;
      exerciseMeta(draft, draft.activeExerciseId).deferred = false;
      persistDraft();
      render();
    });
  });

  app.querySelector("#sessionNotes").addEventListener("input", (event) => {
    draft.notes = event.target.value;
    persistDraft();
  });

  app.querySelector("[data-finish-workout]").addEventListener("click", () => finishWorkout(workout, draftKey));
}

function renderExercise(item, draft, workoutId) {
  const setTotal = activeSetCount(item, draft.lowEnergy);
  const rows = Array.from({ length: setTotal }, (_, index) => renderSetRow(item, draft, index)).join("");
  const meta = exerciseMeta(draft, item.id);
  const actualEquipmentId = currentEquipmentId(item, draft);
  const note = progressionNote(item, workoutId, actualEquipmentId);
  const equipment = equipmentFor(actualEquipmentId);
  const planned = equipmentFor(item.equipmentId);
  const options = replacementOptions(item, actualEquipmentId);
  const replacementText = actualEquipmentId !== item.equipmentId ? `原计划：${planned.label || planned.name}` : statusText(equipment.status);
  const stateClass = meta.deferred ? " deferred" : "";

  return `
    <article class="exercise-card${stateClass}" data-exercise="${item.id}" data-equipment="${actualEquipmentId}">
      <div class="exercise-head">
        <img class="equipment-img" alt="${item.name}" src="${equipment.image}" loading="lazy" data-zoom-image="${equipment.image}" data-zoom-title="${escapeHtml(item.name)}" />
        <div>
          <div class="exercise-title-row">
            <div>
              <h3>${item.name}</h3>
              <p class="cue">${actualEquipmentId} · ${equipment.name}</p>
            </div>
            <span class="target-badge">${setTotal} x ${item.repMin}-${item.repMax}</span>
          </div>
          <p class="cue">${item.cue}</p>
          <p class="cue">${replacementText}</p>
          <p class="progress-note">${note}</p>
          <div class="exercise-actions">
            <button class="mini-button ${meta.deferred ? "active" : ""}" type="button" data-defer-exercise="${item.id}">
              ${meta.deferred ? "回到当前" : "先去下个"}
            </button>
            <button class="mini-button" type="button" data-replace-exercise="${item.id}">换机器</button>
            ${actualEquipmentId !== item.equipmentId ? `<button class="mini-button" type="button" data-reset-equipment="${item.id}">用原机器</button>` : ""}
          </div>
          ${meta.choosingReplacement ? renderReplacementPanel(item, actualEquipmentId, options) : ""}
        </div>
      </div>
      <div class="set-list">${rows}</div>
    </article>
  `;
}

function renderReplacementPanel(item, actualEquipmentId, options) {
  if (!options.length) {
    return `<div class="replacement-panel"><p class="cue">这台暂时没有预设替代，先去下个项目比较稳。</p></div>`;
  }

  return `
    <div class="replacement-panel">
      ${options.map((option) => `
        <button class="replacement-option ${option.id === actualEquipmentId ? "active" : ""}" type="button" data-replacement="${item.id}:${option.id}">
          <img alt="${option.label || option.name}" src="${option.image}" loading="lazy" />
          <span>
            <strong>${option.label || option.name}</strong>
            <small>${option.id} · ${statusText(option.status)}</small>
          </span>
        </button>
      `).join("")}
    </div>
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

  app.querySelectorAll("[data-defer-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      const meta = exerciseMeta(draft, button.dataset.deferExercise);
      meta.deferred = !meta.deferred;
      meta.choosingReplacement = false;
      persistDraft();
      render();
    });
  });

  app.querySelectorAll("[data-replace-exercise]").forEach((button) => {
    button.addEventListener("click", () => {
      const meta = exerciseMeta(draft, button.dataset.replaceExercise);
      meta.choosingReplacement = !meta.choosingReplacement;
      persistDraft();
      render();
    });
  });

  app.querySelectorAll("[data-reset-equipment]").forEach((button) => {
    button.addEventListener("click", () => {
      const meta = exerciseMeta(draft, button.dataset.resetEquipment);
      delete meta.equipmentId;
      meta.choosingReplacement = false;
      persistDraft();
      render();
      toast("已切回原机器");
    });
  });

  app.querySelectorAll("[data-replacement]").forEach((button) => {
    button.addEventListener("click", () => {
      const [exerciseId, equipmentId] = button.dataset.replacement.split(":");
      const meta = exerciseMeta(draft, exerciseId);
      meta.equipmentId = equipmentId;
      meta.deferred = false;
      meta.choosingReplacement = false;
      persistDraft();
      render();
      toast(`已换到 ${equipmentFor(equipmentId).label || equipmentId}`);
    });
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

function renderEquipment() {
  const items = equipmentItems();
  const editing = state.editingEquipmentId;
  const counts = statusCounts(items);

  app.innerHTML = `
    <section class="panel hero-card">
      <div>
        <p class="eyebrow">设备库</p>
        <h2>${items.length} 台机器</h2>
        <p class="muted">状态和替代关系会影响今日训练里的换机器候选。</p>
      </div>
      <div class="metric-grid">
        <div class="metric"><strong>${counts.available}</strong><span class="metric-label">可用</span></div>
        <div class="metric"><strong>${counts.busy}</strong><span class="metric-label">常被占</span></div>
        <div class="metric"><strong>${counts.broken + counts.avoid}</strong><span class="metric-label">避开</span></div>
      </div>
    </section>
    <section class="equipment-list">
      ${items.map((item) => editing === item.id ? renderEquipmentEditor(item, items) : renderEquipmentCard(item)).join("")}
    </section>
  `;

  app.querySelectorAll("[data-edit-equipment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingEquipmentId = button.dataset.editEquipment;
      renderEquipment();
    });
  });

  app.querySelectorAll("[data-cancel-equipment]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingEquipmentId = "";
      renderEquipment();
    });
  });

  app.querySelectorAll("[data-save-equipment]").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest("[data-equipment-editor]");
      const id = card.dataset.equipmentEditor;
      const item = state.equipment[id];
      const altIds = [card.querySelector("[name=alt1]").value, card.querySelector("[name=alt2]").value].filter(Boolean);
      updateEquipmentItem(id, {
        ...item,
        label: card.querySelector("[name=label]").value.trim() || item.label,
        name: card.querySelector("[name=name]").value.trim() || item.name,
        category: card.querySelector("[name=category]").value.trim(),
        status: card.querySelector("[name=status]").value,
        setup: card.querySelector("[name=setup]").value.trim(),
        notes: card.querySelector("[name=notes]").value.trim(),
        alternateEquipmentIds: [...new Set(altIds)]
      });
      await saveEquipmentProfile();
      state.editingEquipmentId = "";
      toast("设备已保存");
      renderEquipment();
    });
  });
}

function renderEquipmentCard(item) {
  return `
    <article class="equipment-card">
      <img class="equipment-card-img" alt="${item.label || item.name}" src="${item.image}" loading="lazy" data-zoom-image="${item.image}" data-zoom-title="${escapeHtml(item.label || item.name)}" />
      <div>
        <div class="equipment-card-head">
          <h3>${item.label || item.name}</h3>
          <span class="status-badge ${item.status || "available"}">${statusText(item.status)}</span>
        </div>
        <p class="cue">${item.id} · ${item.name}</p>
        <p class="cue">${item.category || "未分类"}</p>
        ${item.setup ? `<p class="progress-note">设置：${escapeHtml(item.setup)}</p>` : ""}
        ${item.notes ? `<p class="cue">${escapeHtml(item.notes)}</p>` : ""}
        <div class="mini-alt-row">
          ${(item.alternateEquipmentIds || []).slice(0, 3).map((id) => `<span>${equipmentFor(id).label || id}</span>`).join("")}
        </div>
      </div>
      <button class="mini-button" type="button" data-edit-equipment="${item.id}">编辑</button>
    </article>
  `;
}

function renderEquipmentEditor(item, items) {
  return `
    <article class="equipment-card editing" data-equipment-editor="${item.id}">
      <img class="equipment-card-img" alt="${item.label || item.name}" src="${item.image}" loading="lazy" data-zoom-image="${item.image}" data-zoom-title="${escapeHtml(item.label || item.name)}" />
      <div class="equipment-form">
        <label>显示名<input name="label" value="${escapeHtml(item.label || "")}" /></label>
        <label>英文名<input name="name" value="${escapeHtml(item.name || "")}" /></label>
        <label>分类<input name="category" value="${escapeHtml(item.category || "")}" /></label>
        <label>状态
          <select name="status">
            ${["available", "busy", "broken", "avoid"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${statusText(status)}</option>`).join("")}
          </select>
        </label>
        <label>个人设置<input name="setup" placeholder="座椅、插销、握把" value="${escapeHtml(item.setup || "")}" /></label>
        <label>备注<textarea name="notes" placeholder="不喜欢、容易排队、动作感觉">${escapeHtml(item.notes || "")}</textarea></label>
        <div class="settings-grid two">
          ${renderAlternativeSelect("alt1", item.alternateEquipmentIds?.[0], items, item.id)}
          ${renderAlternativeSelect("alt2", item.alternateEquipmentIds?.[1], items, item.id)}
        </div>
        <div class="action-row">
          <button class="secondary-button" type="button" data-save-equipment="${item.id}">保存</button>
          <button class="secondary-button" type="button" data-cancel-equipment="${item.id}">取消</button>
        </div>
      </div>
    </article>
  `;
}

function renderAlternativeSelect(name, selected, items, ownId) {
  return `
    <label>替代 ${name === "alt1" ? "1" : "2"}
      <select name="${name}">
        <option value="">不设置</option>
        ${items.filter((item) => item.id !== ownId).map((item) => `
          <option value="${item.id}" ${selected === item.id ? "selected" : ""}>${item.label || item.name}</option>
        `).join("")}
      </select>
    </label>
  `;
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
            <img class="equipment-img" alt="${item.name}" src="${equipment.image}" loading="lazy" data-zoom-image="${equipment.image}" data-zoom-title="${escapeHtml(item.name)}" />
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
    const replaced = item.replaced ? " · 替换" : "";
    return `<li>${item.name} (${item.equipmentId || ""}): ${done} 组${topText}${replaced}</li>`;
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
  const user = state.user || { id: "local-user", name: "Local User", provider: "local", authenticated: false };
  app.innerHTML = `
    <section class="panel">
      <h2>账号</h2>
      <div class="account-row">
        <div>
          <strong>${escapeHtml(user.name || user.id)}</strong>
          <p class="cue">${user.authenticated ? `Microsoft 登录 · ${user.provider}` : "本地开发/未登录模式"}</p>
        </div>
        <span class="status-badge ${user.authenticated ? "available" : "busy"}">${user.authenticated ? "已登录" : "未登录"}</span>
      </div>
      <div class="action-row">
        <button class="secondary-button" type="button" data-login>Microsoft 登录</button>
        <button class="secondary-button" type="button" data-logout>退出登录</button>
      </div>
    </section>
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

  app.querySelector("[data-login]").addEventListener("click", () => {
    window.location.href = loginUrl();
  });

  app.querySelector("[data-logout]").addEventListener("click", () => {
    window.location.href = `${authBaseUrl()}/.auth/logout?post_logout_redirect_uri=${encodeURIComponent(window.location.href)}`;
  });

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
    exercises: workoutExercises(workout, draft)
      .filter((item) => activeSetCount(item, draft.lowEnergy) > 0)
      .map((item) => {
        const meta = exerciseMeta(draft, item.id);
        const actualEquipmentId = currentEquipmentId(item, draft);
        const equipment = equipmentFor(actualEquipmentId);
        const plannedEquipment = equipmentFor(item.equipmentId);
        return {
          id: item.id,
          name: item.name,
          equipmentId: actualEquipmentId,
          equipmentName: equipment.name,
          plannedEquipmentId: item.equipmentId,
          plannedEquipmentName: plannedEquipment.name,
          replaced: actualEquipmentId !== item.equipmentId,
          deferred: Boolean(meta.deferred),
          adHoc: Boolean(item.adHoc),
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
    await fetchJson(apiUrl("/sessions"), {
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
    const data = await fetchJson(apiUrl("/plans"), {
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
    await fetchJson(apiUrl("/settings"), {
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
  return { workoutId: workout.id, lowEnergy: false, notes: "", exercises, exerciseMeta: {}, extraExercises: [], addingExercise: false };
}

function ensureDraftShape(draft) {
  draft.exercises ||= {};
  draft.exerciseMeta ||= {};
  draft.extraExercises ||= [];
  draft.addingExercise = Boolean(draft.addingExercise);
  draft.activeExerciseId ||= "";
  return draft;
}

function workoutExercises(workout, draft) {
  ensureDraftShape(draft);
  return [...(workout.exercises || []), ...draft.extraExercises];
}

function exerciseMeta(draft, exerciseId) {
  ensureDraftShape(draft);
  draft.exerciseMeta[exerciseId] ||= {};
  return draft.exerciseMeta[exerciseId];
}

function currentEquipmentId(item, draft) {
  return exerciseMeta(draft, item.id).equipmentId || item.equipmentId;
}

function orderedExercises(exercises, draft) {
  return [...exercises].sort((a, b) => {
    const aDeferred = exerciseMeta(draft, a.id).deferred ? 1 : 0;
    const bDeferred = exerciseMeta(draft, b.id).deferred ? 1 : 0;
    return aDeferred - bDeferred;
  });
}

function activeDeckExercise(visibleExercises, draft) {
  const active = visibleExercises.find((item) => item.id === draft.activeExerciseId);
  if (active) return active;

  const next = visibleExercises.find((item) => !exerciseMeta(draft, item.id).deferred && completeSetsForExercise(item, draft) < activeSetCount(item, draft.lowEnergy));
  const fallback = next || visibleExercises.find((item) => completeSetsForExercise(item, draft) < activeSetCount(item, draft.lowEnergy)) || visibleExercises[0];
  draft.activeExerciseId = fallback?.id || "";
  return fallback;
}

function currentSetIndex(item, draft) {
  const setTotal = activeSetCount(item, draft.lowEnergy);
  const sets = draft.exercises[item.id] || [];
  const index = sets.slice(0, setTotal).findIndex((set) => !set?.done);
  return index === -1 ? Math.max(0, setTotal - 1) : index;
}

function completeSetsForExercise(item, draft) {
  return (draft.exercises[item.id] || [])
    .slice(0, activeSetCount(item, draft.lowEnergy))
    .filter((set) => set?.done)
    .length;
}

function countVisibleCompleteSets(visibleExercises, draft) {
  return visibleExercises.reduce((sum, item) => sum + completeSetsForExercise(item, draft), 0);
}

function focusNextExercise(workout, draft, current) {
  const visibleExercises = orderedExercises(workoutExercises(workout, draft), draft).filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
  const currentIndex = visibleExercises.findIndex((item) => item.id === current.id);
  const after = visibleExercises.slice(currentIndex + 1).find((item) => !exerciseMeta(draft, item.id).deferred && completeSetsForExercise(item, draft) < activeSetCount(item, draft.lowEnergy));
  const before = visibleExercises.slice(0, currentIndex + 1).find((item) => !exerciseMeta(draft, item.id).deferred && completeSetsForExercise(item, draft) < activeSetCount(item, draft.lowEnergy));
  const fallback = visibleExercises.find((item) => completeSetsForExercise(item, draft) < activeSetCount(item, draft.lowEnergy));
  draft.activeExerciseId = (after || before || fallback || current)?.id || "";
}

function handleIssueAction(workout, draft, exerciseId, action) {
  const meta = exerciseMeta(draft, exerciseId);
  const item = workoutExercises(workout, draft).find((exercise) => exercise.id === exerciseId);
  if (!item) return;

  meta.showIssue = false;
  if (action === "busy") {
    meta.issue = "机器被占";
    meta.deferred = true;
    appendDraftNote(draft, `${item.name}: 机器被占，先跳过`);
    focusNextExercise(workout, draft, item);
    return;
  }
  if (action === "broken") {
    meta.issue = "机器坏了";
    meta.choosingReplacement = true;
    appendDraftNote(draft, `${item.name}: 机器坏了，尝试替代`);
    return;
  }
  if (action === "pain") {
    meta.issue = "不舒服";
    meta.deferred = true;
    appendDraftNote(draft, `${item.name}: 不舒服，今天先不硬做`);
    focusNextExercise(workout, draft, item);
    return;
  }
  if (action === "tired") {
    draft.lowEnergy = true;
    appendDraftNote(draft, "今天状态偏累，已切低疲劳模式");
  }
}

function appendDraftNote(draft, text) {
  const existing = (draft.notes || "").trim();
  draft.notes = existing ? `${existing}\n${text}` : text;
}

function addExtraExerciseFromPanel(draft) {
  const panel = app.querySelector("[data-add-exercise-panel]");
  if (!panel) return;

  const equipmentId = panel.querySelector("[name=equipmentId]").value;
  const equipment = equipmentFor(equipmentId);
  const sets = clampNumber(panel.querySelector("[name=sets]").value, 1, 6, 2);
  const repMin = clampNumber(panel.querySelector("[name=repMin]").value, 1, 50, 10);
  const repMax = Math.max(repMin, clampNumber(panel.querySelector("[name=repMax]").value, 1, 50, 12));
  const rawName = panel.querySelector("[name=name]").value.trim();
  const id = `extra-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    name: rawName || equipment.label || equipment.name || "临时加项",
    equipmentId,
    alternateEquipmentIds: equipment.alternateEquipmentIds || [],
    sets,
    repMin,
    repMax,
    cue: "临时加项，保留 2-3 次余力，别练到崩。",
    priority: "extra",
    adHoc: true
  };

  draft.extraExercises.push(item);
  draft.exercises[id] = Array.from({ length: sets }, () => ({ weight: "", reps: "", rir: "", done: false }));
  draft.activeExerciseId = id;
  draft.addingExercise = false;
  appendDraftNote(draft, `临时加项: ${item.name}`);
  toast("已加到今天");
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function ensureSetEntry(draft, exerciseId, index) {
  draft.exercises[exerciseId] ||= [];
  draft.exercises[exerciseId][index] ||= { weight: "", reps: "", rir: "", done: false };
  return draft.exercises[exerciseId][index];
}

function activeSetCount(item, lowEnergy) {
  if (!lowEnergy) return item.sets;
  if (item.priority === "extra" || item.adHoc) return item.sets;
  if (item.priority === "main") return item.sets;
  if (item.priority === "support") return Math.min(item.sets, 2);
  return 0;
}

function countCompleteSets(draft) {
  return Object.values(draft.exercises).flat().filter((set) => set?.done).length;
}

function refreshTodayMetrics(workout, draft) {
  const metrics = app.querySelectorAll(".metric strong");
  const visibleExercises = workoutExercises(workout, draft).filter((item) => activeSetCount(item, draft.lowEnergy) > 0);
  if (metrics[0]) metrics[0].textContent = countCompleteSets(draft);
  if (metrics[1]) metrics[1].textContent = visibleExercises.reduce((sum, item) => sum + activeSetCount(item, draft.lowEnergy), 0);
}

function fillLastWeights(workout, draft) {
  workoutExercises(workout, draft).forEach((item) => {
    const last = latestExercise(item.id, currentEquipmentId(item, draft), workout.id);
    if (!last) return;
    (last.sets || []).forEach((set, index) => {
      const entry = ensureSetEntry(draft, item.id, index);
      entry.weight = set.weight || entry.weight || "";
    });
  });
}

function progressionNote(item, workoutId, equipmentId = item.equipmentId) {
  const last = latestExercise(item.id, equipmentId, workoutId);
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

function equipmentItems() {
  return state.equipmentProfile.items || Object.values(state.equipment);
}

function updateEquipmentItem(id, patch) {
  const items = equipmentItems().map((item) => item.id === id ? { ...item, ...patch } : item);
  applyEquipmentProfile({ ...state.equipmentProfile, items });
}

async function saveEquipmentProfile() {
  localStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(state.equipmentProfile));
  try {
    const data = await fetchJson(apiUrl("/equipment"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.equipmentProfile)
    });
    applyEquipmentProfile(data.equipment);
    localStorage.setItem(STORAGE_KEYS.equipment, JSON.stringify(state.equipmentProfile));
    state.apiOnline = true;
  } catch {
    state.apiOnline = false;
  }
}

function replacementOptions(item, currentEquipmentId) {
  const planned = equipmentFor(item.equipmentId);
  const ids = [
    ...(item.alternateEquipmentIds || []),
    ...(planned.alternateEquipmentIds || [])
  ].filter((id) => id && id !== currentEquipmentId);
  return [...new Set(ids)]
    .map(equipmentFor)
    .filter((equipment) => equipment.id && equipment.id !== item.equipmentId)
    .sort((a, b) => statusRank(a.status) - statusRank(b.status))
    .slice(0, 4);
}

function statusCounts(items) {
  return items.reduce((acc, item) => {
    const status = item.status || "available";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, { available: 0, busy: 0, broken: 0, avoid: 0 });
}

function statusText(status = "available") {
  return {
    available: "可用",
    busy: "常被占",
    broken: "维修",
    avoid: "避开"
  }[status] || "可用";
}

function statusRank(status = "available") {
  return { available: 0, busy: 1, avoid: 2, broken: 3 }[status] ?? 0;
}

function apiUrl(path) {
  const base = configuredApiBaseUrl();
  return `${base}/api${path}`;
}

function authBaseUrl() {
  return configuredApiBaseUrl();
}

function loginRequired() {
  return Boolean(state.config.requireAuth || state.user?.authRequired);
}

function loginUrl() {
  return `${authBaseUrl()}/.auth/login/aad?post_login_redirect_uri=${encodeURIComponent(window.location.href)}`;
}

function configuredApiBaseUrl() {
  const base = (state.config.apiBaseUrl || "").replace(/\/$/, "");
  if (window.location.hostname === "gym.zy8095.io" && base.includes("azurewebsites.net")) return "";
  return base;
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
  return { today: "今日", equipment: "设备库", plan: "训练计划", history: "历史记录", settings: "设置" }[route] || "Gym Check-in";
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

function openImageZoom(src, titleText) {
  if (!src) return;
  closeImageZoom();
  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <button class="image-modal-backdrop" type="button" data-close-image></button>
    <div class="image-modal-content">
      <header>
        <strong>${escapeHtml(titleText || "器械图片")}</strong>
        <button class="mini-button" type="button" data-close-image>关闭</button>
      </header>
      <img alt="${escapeHtml(titleText || "器械图片")}" src="${src}" />
    </div>
  `;
  modal.querySelectorAll("[data-close-image]").forEach((button) => {
    button.addEventListener("click", closeImageZoom);
  });
  document.body.append(modal);
}

function closeImageZoom() {
  document.querySelector(".image-modal")?.remove();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
