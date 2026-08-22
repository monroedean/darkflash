const appElement = requiredElement("app");
let snapshot: AutomationSnapshot | undefined;
let errorMessage = "";

window.darkflash.onSnapshot((nextSnapshot) => {
  snapshot = nextSnapshot;
  render();
});

void window.darkflash
  .getSnapshot()
  .then((nextSnapshot) => {
    snapshot = nextSnapshot;
    render();
  })
  .catch(showError);

function render(): void {
  if (snapshot === undefined) {
    appElement.innerHTML = `<div class="loading">Finding displays…</div>`;
    return;
  }

  appElement.innerHTML = `
    <header class="hero">
      <div>
        <p class="eyebrow">CONTENT COMPENSATION</p>
        <h1>Darkflash</h1>
        <p class="lede">Comfortable physical brightness as your screen changes.</p>
      </div>
      <label class="power-control">
        <input id="enabled" type="checkbox" ${snapshot.enabled ? "checked" : ""}>
        <span class="switch" aria-hidden="true"></span>
        <span>${snapshot.enabled ? "Active" : "Off"}</span>
      </label>
    </header>
    ${errorMessage ? `<div class="error-banner" role="alert">${escapeHtml(errorMessage)}</div>` : ""}
    <section class="section-heading">
      <div>
        <p class="eyebrow">DISPLAYS</p>
        <h2>${snapshot.monitors.length === 1 ? "1 physical monitor" : `${snapshot.monitors.length} physical monitors`}</h2>
      </div>
      <button id="refresh" class="quiet-button">Refresh</button>
    </section>
    <main class="monitor-list">
      ${snapshot.monitors.length === 0 ? emptyState() : snapshot.monitors.map(monitorCard).join("")}
    </main>
    <footer>Frames are sampled locally in memory and immediately discarded. No telemetry.</footer>
  `;

  requiredInput("enabled").addEventListener("change", (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    void perform(() => window.darkflash.setEnabled(enabled));
  });
  requiredElement("refresh").addEventListener("click", () => {
    void perform(() => window.darkflash.refreshDisplays());
  });
  for (const monitor of snapshot.monitors) bindMonitor(monitor);
}

function monitorCard(monitor: MonitorSnapshot): string {
  const disabled = monitor.settingsEditable ? "" : "disabled";
  return `
    <article class="monitor-card" data-monitor-id="${escapeHtml(monitor.id)}">
      <div class="monitor-title">
        <div class="monitor-glyph" aria-hidden="true"><span></span></div>
        <div>
          <h3>${escapeHtml(monitor.name)}</h3>
          <p>${statusDescription(monitor.status)}</p>
        </div>
        <span class="status status-${monitor.status.kind}">${statusName(monitor.status)}</span>
      </div>
      <div class="controls ${disabled}">
        ${rangeControl(monitor, "minimumBrightness", "Minimum", "Lowest brightness allowed", 0, 100, 1, "%")}
        ${rangeControl(monitor, "maximumBrightness", "Maximum", "Highest brightness allowed", 0, 100, 1, "%")}
        ${rangeControl(monitor, "effectStrength", "Effect", "How strongly content moves brightness", 0, 1, 0.01, "%")}
        ${rangeControl(monitor, "responseSpeed", "Response", "Slow and steady to quick adaptation", 0, 1, 0.01, "%")}
      </div>
    </article>
  `;
}

function rangeControl(
  monitor: MonitorSnapshot,
  key: keyof MonitorSettings,
  label: string,
  hint: string,
  minimum: number,
  maximum: number,
  step: number,
  suffix: string,
): string {
  const value = monitor.settings[key];
  const shownValue = key === "effectStrength" || key === "responseSpeed"
    ? Math.round(value * 100)
    : Math.round(value);
  const disabled = monitor.settingsEditable ? "" : "disabled";
  return `
    <label class="range-row">
      <span class="range-copy"><strong>${label}</strong><small>${hint}</small></span>
      <input type="range" data-setting="${key}" min="${minimum}" max="${maximum}" step="${step}" value="${value}" ${disabled}>
      <output data-output="${key}">${shownValue}${suffix}</output>
    </label>
  `;
}

function bindMonitor(monitor: MonitorSnapshot): void {
  const card = document.querySelector<HTMLElement>(
    `[data-monitor-id="${CSS.escape(monitor.id)}"]`,
  );
  if (card === null) return;
  const inputs = card.querySelectorAll<HTMLInputElement>("input[data-setting]");
  for (const input of inputs) {
    input.addEventListener("input", () => {
      const key = input.dataset.setting as keyof MonitorSettings;
      const output = card.querySelector<HTMLOutputElement>(
        `[data-output="${key}"]`,
      );
      if (output !== null) {
        const value = Number(input.value);
        output.value = `${key === "effectStrength" || key === "responseSpeed" ? Math.round(value * 100) : Math.round(value)}%`;
      }
    });
    input.addEventListener("change", () => {
      const settings = readMonitorSettings(card);
      void perform(() =>
        window.darkflash.updateMonitorSettings(monitor.id, settings),
      );
    });
  }
}

function readMonitorSettings(card: HTMLElement): MonitorSettings {
  const value = (key: keyof MonitorSettings): number => {
    const input = card.querySelector<HTMLInputElement>(
      `[data-setting="${key}"]`,
    );
    if (input === null) throw new Error(`Missing ${key} control`);
    return Number(input.value);
  };
  return {
    minimumBrightness: value("minimumBrightness"),
    maximumBrightness: value("maximumBrightness"),
    effectStrength: value("effectStrength"),
    responseSpeed: value("responseSpeed"),
  };
}

async function perform(
  action: () => Promise<AutomationSnapshot>,
): Promise<void> {
  try {
    errorMessage = "";
    snapshot = await action();
  } catch (error) {
    showError(error);
  }
  render();
}

function showError(error: unknown): void {
  errorMessage = error instanceof Error ? error.message : String(error);
  render();
}

function statusName(status: MonitorStatus): string {
  switch (status.kind) {
    case "active": return "Active";
    case "disabled": return "Off";
    case "paused": return "Paused";
    case "unsupported": return "Unsupported";
    case "error": return "Error";
  }
}

function statusDescription(status: MonitorStatus): string {
  switch (status.kind) {
    case "active": return "Adapting physical brightness";
    case "disabled": return "Automation is turned off";
    case "paused": return `Holding steady: ${status.reason.replaceAll("-", " ")}`;
    case "unsupported": return status.message;
    case "error": return status.message;
  }
}

function emptyState(): string {
  return `
    <div class="empty-state">
      <div class="empty-icon">×</div>
      <h3>No controllable displays found</h3>
      <p>Connect a display and enable DDC/CI in its on-screen menu, then refresh.</p>
    </div>
  `;
}

function requiredElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing #${id}`);
  return element;
}

function requiredInput(id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing #${id}`);
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}
