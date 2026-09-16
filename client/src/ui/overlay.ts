import { CLASSES, type EvolutionOption } from "shared";

const overlay = document.getElementById("ui-overlay") as HTMLDivElement;
const panel = document.getElementById("panel-content") as HTMLDivElement;

export function showMainMenu(onPlay: () => void, onHowToPlay: () => void) {
  panel.innerHTML = "";

  const brand = document.createElement("div");
  brand.className = "brand";
  brand.textContent = "FRENTE ABIERTO";
  panel.appendChild(brand);

  const tagline = document.createElement("div");
  tagline.className = "tagline";
  tagline.textContent = "Shooter táctico por equipos";
  panel.appendChild(tagline);

  const playBtn = document.createElement("button");
  playBtn.className = "primary";
  playBtn.textContent = "Jugar";
  playBtn.onclick = () => {
    hideOverlay();
    onPlay();
  };
  panel.appendChild(playBtn);

  const howToBtn = document.createElement("button");
  howToBtn.className = "secondary";
  howToBtn.textContent = "Cómo jugar";
  howToBtn.onclick = onHowToPlay;
  panel.appendChild(howToBtn);

  const streamerLink = document.createElement("button");
  streamerLink.className = "secondary";
  streamerLink.textContent = "Crear sala de streamer";
  streamerLink.onclick = () => {
    location.search = "?streamer=1";
  };
  panel.appendChild(streamerLink);

  overlay.classList.remove("hidden");
}

export function showHowToPlay(onBack: () => void) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Cómo jugar";
  panel.appendChild(title);

  const list = document.createElement("div");
  list.className = "kbd-list";
  const rows: [string, string][] = [
    ["WASD", "Moverse"],
    ["Mouse", "Apuntar"],
    ["Clic izq.", "Disparar"],
    ["E", "Subir / bajar de un vehículo"],
    ["Esc", "Pausa"],
  ];
  rows.forEach(([key, desc]) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = key;
    const span = document.createElement("span");
    span.textContent = desc;
    list.appendChild(kbd);
    list.appendChild(span);
  });
  panel.appendChild(list);

  const p = document.createElement("p");
  p.textContent =
    "Capturá los puntos de control para hacer bajar los tickets del equipo rival. El equipo con más tickets cuando se acaba el tiempo (o que agota los del rival) gana la partida.";
  panel.appendChild(p);

  const backBtn = document.createElement("button");
  backBtn.className = "primary";
  backBtn.textContent = "Volver";
  backBtn.onclick = onBack;
  panel.appendChild(backBtn);

  overlay.classList.remove("hidden");
}

export function showPauseMenu(onResume: () => void, onLeave: () => void) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Pausa";
  panel.appendChild(title);

  const resumeBtn = document.createElement("button");
  resumeBtn.className = "primary";
  resumeBtn.textContent = "Continuar";
  resumeBtn.onclick = () => {
    hideOverlay();
    onResume();
  };
  panel.appendChild(resumeBtn);

  const leaveBtn = document.createElement("button");
  leaveBtn.className = "danger";
  leaveBtn.textContent = "Salir de la partida";
  leaveBtn.onclick = onLeave;
  panel.appendChild(leaveBtn);

  overlay.classList.remove("hidden");
}

export function showClassSelect(onPick: (classId: string) => void) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Elegí tu clase";
  panel.appendChild(title);

  Object.values(CLASSES).forEach((def) => {
    const btn = document.createElement("button");
    btn.textContent = `${def.name} (HP ${def.baseStats.maxHp}, Vel ${def.baseStats.speed})`;
    btn.onclick = () => {
      hideOverlay();
      onPick(def.id);
    };
    panel.appendChild(btn);
  });

  overlay.classList.remove("hidden");
}

export function showEvolutionChoice(options: EvolutionOption[], onPick: (optionId: string) => void) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "¡Subiste de nivel! Elegí una mejora";
  panel.appendChild(title);

  options.forEach((option) => {
    const btn = document.createElement("button");
    btn.textContent = option.label;
    btn.onclick = () => {
      hideOverlay();
      onPick(option.id);
    };
    panel.appendChild(btn);
  });

  overlay.classList.remove("hidden");
}

export function hideOverlay() {
  overlay.classList.add("hidden");
}

export function updateHud(text: string) {
  const hud = document.getElementById("hud")!;
  hud.textContent = text;
}

export function updateTickets(redTickets: number, blueTickets: number, timeRemainingSec: number, maxTickets: number) {
  const el = document.getElementById("tickets")!;
  const minutes = Math.floor(timeRemainingSec / 60);
  const seconds = Math.floor(timeRemainingSec % 60)
    .toString()
    .padStart(2, "0");
  const redRatio = Math.max(0, Math.min(1, redTickets / maxTickets));
  const blueRatio = Math.max(0, Math.min(1, blueTickets / maxTickets));

  el.innerHTML = `
    <div>Rojo ${Math.ceil(redTickets)} — ${minutes}:${seconds} — Azul ${Math.ceil(blueTickets)}</div>
    <div class="bars">
      <div class="bar-bg"><div class="bar-red" style="width:${redRatio * 100}%"></div></div>
      <div class="bar-bg"><div class="bar-blue" style="width:${blueRatio * 100}%"></div></div>
    </div>
  `;
}

export function updateVehicleHint(text: string | null) {
  const el = document.getElementById("vehicle-hint")!;
  if (!text) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

export function showStreamerSetup(
  onCreate: (opts: { streamerName: string; whitelist: string[]; friendlyFire: boolean }) => void
) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "Panel del streamer";
  panel.appendChild(title);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Tu nombre de usuario";
  panel.appendChild(nameInput);

  const whitelistArea = document.createElement("textarea");
  whitelistArea.placeholder = "Usuarios permitidos, uno por línea (whitelist manual)";
  whitelistArea.rows = 4;
  panel.appendChild(whitelistArea);

  const ffLabel = document.createElement("label");
  const ffCheckbox = document.createElement("input");
  ffCheckbox.type = "checkbox";
  ffLabel.appendChild(ffCheckbox);
  ffLabel.append("Fuego amigo activado");
  panel.appendChild(ffLabel);

  const btn = document.createElement("button");
  btn.textContent = "Crear sala";
  btn.onclick = () => {
    const streamerName = nameInput.value.trim();
    if (!streamerName) return;
    const whitelist = whitelistArea.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    hideOverlay();
    onCreate({ streamerName, whitelist, friendlyFire: ffCheckbox.checked });
  };
  panel.appendChild(btn);

  overlay.classList.remove("hidden");
}

export function showViewerNamePrompt(roomCode: string, onSubmit: (displayName: string) => void) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = `Unirse a la sala ${roomCode}`;
  panel.appendChild(title);

  const hint = document.createElement("p");
  hint.style.fontSize = "13px";
  hint.style.opacity = "0.8";
  hint.textContent = "Tu nombre debe estar en la whitelist del streamer para poder entrar.";
  panel.appendChild(hint);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Tu nombre de usuario";
  panel.appendChild(nameInput);

  const btn = document.createElement("button");
  btn.textContent = "Entrar";
  btn.onclick = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    hideOverlay();
    onSubmit(name);
  };
  panel.appendChild(btn);

  overlay.classList.remove("hidden");
}

export function showJoinError(message: string) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent = "No se pudo entrar";
  panel.appendChild(title);
  const p = document.createElement("p");
  p.textContent = message;
  panel.appendChild(p);
  overlay.classList.remove("hidden");
}

export function showRoomInfo(roomCode: string, joinUrl: string) {
  const el = document.getElementById("room-info")!;
  el.innerHTML = `Sala: <strong>${roomCode}</strong><br/>Link: ${joinUrl}`;
  el.classList.remove("hidden");
}

export function updateCommanderPanel(commandPoints: number, onSimulateEvent: () => void, onClose?: () => void) {
  const el = document.getElementById("commander-panel")!;
  el.classList.remove("hidden");
  el.innerHTML = `Puntos de comando: ${commandPoints}<br/>Clic derecho: bombardeo (cuesta 3)`;
  const btn = document.createElement("button");
  btn.textContent = "Simular evento de sub (+1)";
  btn.onclick = onSimulateEvent;
  el.appendChild(document.createElement("br"));
  el.appendChild(btn);
}

export function updatePerfPanel(fps: number, pingMs: number | null, counts: { players: number; projectiles: number; vehicles: number }) {
  const el = document.getElementById("perf-panel")!;
  el.classList.remove("hidden");

  const fpsClass = fps >= 50 ? "" : fps >= 30 ? "warn" : "bad";
  const pingClass = pingMs === null ? "" : pingMs <= 80 ? "" : pingMs <= 150 ? "warn" : "bad";
  const pingText = pingMs === null ? "—" : `${Math.round(pingMs)}ms`;

  el.innerHTML = `
    <div class="${fpsClass}">FPS: ${Math.round(fps)}</div>
    <div class="${pingClass}">Ping: ${pingText}</div>
    <div>Jug: ${counts.players} · Proy: ${counts.projectiles} · Veh: ${counts.vehicles}</div>
  `;
}

export function toggleElementHidden(id: string) {
  document.getElementById(id)?.classList.toggle("hidden");
}

export function showMatchEnd(winningTeam: string) {
  panel.innerHTML = "";
  const title = document.createElement("h2");
  title.textContent =
    winningTeam === "draw" ? "¡Empate!" : winningTeam === "red" ? "¡Gana el equipo Rojo!" : "¡Gana el equipo Azul!";
  panel.appendChild(title);
  overlay.classList.remove("hidden");
}
