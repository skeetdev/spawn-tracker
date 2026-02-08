(function () {
  const apiKeyInput = document.getElementById("apiKey");
  const logPathInput = document.getElementById("logPath");
  const browseBtn = document.getElementById("browseBtn");
  const saveBtn = document.getElementById("saveBtn");
  const startStopBtn = document.getElementById("startStopBtn");
  const statusEl = document.getElementById("status");
  const debugToggleBtn = document.getElementById("debugToggleBtn");
  const debugSection = document.getElementById("debugSection");
  const debugConsole = document.getElementById("debugConsole");
  const clearDebugBtn = document.getElementById("clearDebugBtn");

  let isWatching = false;
  let debugVisible = false;

  const statusMessages = {
    stopped: "Stopped.",
    starting: "Starting...",
    saved: "Saved.",
    connected: "Connected. Watching log.",
    invalid_key: "Invalid password. Check with your admin.",
    file_not_found: "Log file not found. Check path.",
    missing_config: "Fill in password and log path.",
    server_offline: "Server is offline or unreachable.",
    error: "Connection or file error.",
  };

  let lastStatus = "stopped";

  function setStatus(status) {
    lastStatus = status;
    statusEl.textContent = statusMessages[status] || status;
    const isError = status !== "stopped" && status !== "starting" && status !== "connected" && status !== "saved";
    statusEl.className = "status " + (status === "connected" ? "connected" : status === "saved" ? "saved" : isError ? "error" : "");
  }

  function updateStartStopButton() {
    if (isWatching) {
      startStopBtn.textContent = "Stop";
      startStopBtn.className = "stop";
    } else {
      startStopBtn.textContent = "Start";
      startStopBtn.className = "";
    }
  }

  async function loadSettings() {
    const s = await window.repopApi.getSettings();
    apiKeyInput.value = s.apiKey || "";
    logPathInput.value = s.logPath || "";
  }

  async function pickLogFile() {
    const path = await window.repopApi.showOpenDialog();
    if (path) logPathInput.value = path;
  }

  browseBtn.addEventListener("click", pickLogFile);
  logPathInput.addEventListener("click", pickLogFile);

  saveBtn.addEventListener("click", async () => {
    const apiKey = apiKeyInput.value.trim();
    const logPath = logPathInput.value.trim();
    await window.repopApi.setSettings({ apiKey, logPath });
    setStatus("saved");
    statusEl.className = "status saved";
    setTimeout(() => {
      if (statusEl.textContent === "Saved.") setStatus("stopped");
    }, 2000);
  });

  startStopBtn.addEventListener("click", async () => {
    if (isWatching) {
      await window.repopApi.stopWatching();
      isWatching = false;
      setStatus("stopped");
    } else {
      setStatus("starting");
      await window.repopApi.setSettings({
        apiKey: apiKeyInput.value.trim(),
        logPath: logPathInput.value.trim(),
      });
      await window.repopApi.startWatching();
      isWatching = true;
    }
    updateStartStopButton();
  });

  window.repopApi.onConnectionStatus((status) => {
    setStatus(status);
    if (status !== "connected") {
      isWatching = false;
      updateStartStopButton();
    }
  });

  function addDebugLine(message, type = "info") {
    const line = document.createElement("div");
    line.className = `debug-line ${type}`;
    const timestamp = new Date().toLocaleTimeString();
    line.textContent = `[${timestamp}] ${message}`;
    debugConsole.appendChild(line);
    debugConsole.scrollTop = debugConsole.scrollHeight;

    // Keep only last 500 lines
    while (debugConsole.children.length > 500) {
      debugConsole.removeChild(debugConsole.firstChild);
    }
  }

  debugToggleBtn.addEventListener("click", () => {
    debugVisible = !debugVisible;
    if (debugVisible) {
      debugSection.classList.add("visible");
      window.repopApi.setWindowSize(480, 780);
    } else {
      debugSection.classList.remove("visible");
      window.repopApi.setWindowSize(480, 420);
    }
  });

  clearDebugBtn.addEventListener("click", () => {
    debugConsole.innerHTML = "";
  });

  window.repopApi.onDebugLog((message, type) => {
    addDebugLine(message, type);
  });

  (async function init() {
    await loadSettings();
  })();
})();
