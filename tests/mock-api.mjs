// Mock implementation of native "motrix:plugin-api" for automated test suites

export const state = {
  registeredCommands: new Map(),
  beforeCreateHook: null,
  logs: [],
  notifications: [],
  httpRequests: [],
  httpMockResponse: { status: 200, body: JSON.stringify({ status: "success", data: { hosts: {} } }) },
  configStore: new Map(),
  storageStore: new Map()
};

export function resetMockState() {
  state.registeredCommands.clear();
  state.beforeCreateHook = null;
  state.logs.length = 0;
  state.notifications.length = 0;
  state.httpRequests.length = 0;
  state.httpMockResponse = { status: 200, body: JSON.stringify({ status: "success", data: { hosts: {} } }) };
  state.configStore.clear();
  state.storageStore.clear();
}

export const commands = {
  register: (id, handler) => {
    state.registeredCommands.set(id, handler);
  }
};

export const config = {
  get: async (key) => state.configStore.get(key) ?? (key === "enabled" ? true : undefined),
  set: async (key, val) => { state.configStore.set(key, val); }
};

export const hooks = {
  beforeCreate: (handler) => {
    state.beforeCreateHook = handler;
  }
};

export const http = {
  request: async (opts) => {
    state.httpRequests.push(opts);
    if (typeof state.httpMockResponse === "function") {
      return await state.httpMockResponse(opts);
    }
    return state.httpMockResponse;
  }
};

export const lifecycle = {
  onDeactivate: () => {}
};

function recordLog(level, msg, meta) {
  state.logs.push({ level, msg, meta });
}

export const log = {
  debug: (msg, meta) => recordLog("debug", msg, meta),
  info: (msg, meta) => recordLog("info", msg, meta),
  warn: (msg, meta) => recordLog("warn", msg, meta),
  error: (msg, meta) => recordLog("error", msg, meta)
};

export const notify = {
  show: async (payload) => {
    state.notifications.push(payload);
  }
};

export const storage = {
  get: async (key) => state.storageStore.get(key) ?? null,
  set: async (key, val) => { state.storageStore.set(key, val); }
};
