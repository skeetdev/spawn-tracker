(function () {
  const apiKeyInput = document.getElementById("apiKey");
  const logPathInput = document.getElementById("logPath");
  const browseBtn = document.getElementById("browseBtn");
  const saveBtn = document.getElementById("saveBtn");
  const startStopBtn = document.getElementById("startStopBtn");
  const statusEl = document.getElementById("status");

  let isWatching = false;

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
  (async function init() {
    await loadSettings();
  })();
})();
