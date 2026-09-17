import { NetworkManager } from "./net/NetworkManager";
import { GameScene } from "./scenes/GameScene";
import { generateRoomCode } from "shared";
import {
  showConnecting,
  showStreamerSetup,
  showViewerNamePrompt,
  showJoinError,
  showRoomInfo,
  showMainMenu,
  showHowToPlay,
  hideOverlay,
} from "./ui/overlay";

async function main() {
  const appEl = document.getElementById("app")!;
  const params = new URLSearchParams(location.search);
  const roomCodeParam = params.get("room");
  const isStreamerMode = params.get("streamer") === "1";

  if (isStreamerMode) {
    showStreamerSetup(async ({ streamerName, whitelist, friendlyFire }) => {
      showConnecting("Creando sala...");
      const network = new NetworkManager();
      const roomCode = generateRoomCode();
      try {
        const room = await network.createStreamerRoom({ roomCode, streamerName, friendlyFire, whitelist });
        const joinUrl = `${location.origin}${location.pathname}?room=${roomCode}`;
        hideOverlay();
        showRoomInfo(roomCode, joinUrl);
        new GameScene(room, appEl, { isCommander: true });
      } catch (err) {
        console.error("Error creando la sala de streamer", err);
        showJoinError("No se pudo crear la sala. Revisá la consola para más detalles.");
      }
    });
    return;
  }

  if (roomCodeParam) {
    showViewerNamePrompt(roomCodeParam, async (displayName) => {
      showConnecting();
      const network = new NetworkManager();
      try {
        const room = await network.joinStreamerRoom(roomCodeParam, displayName);
        hideOverlay();
        new GameScene(room, appEl, { isCommander: false });
      } catch (err) {
        console.error("Error uniéndose a la sala de streamer", err);
        showJoinError("Tu nombre no está en la whitelist de esta sala, o el código es inválido.");
      }
    });
    return;
  }

  const startGame = async () => {
    showConnecting();
    const network = new NetworkManager();
    try {
      const room = await network.connect();
      hideOverlay();
      new GameScene(room, appEl, { isCommander: false });
    } catch (err) {
      console.error("Error conectando al servidor", err);
      showJoinError("No se pudo conectar al servidor. Revisá la consola para más detalles.");
    }
  };

  const openMainMenu = () => {
    showMainMenu(startGame, () => showHowToPlay(openMainMenu));
  };
  openMainMenu();
}

main().catch((err) => {
  console.error("Error iniciando el juego", err);
});
