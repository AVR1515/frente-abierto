import { NetworkManager } from "./net/NetworkManager";
import { GameScene } from "./scenes/GameScene";
import { generateRoomCode } from "shared";
import {
  showClassSelect,
  showStreamerSetup,
  showViewerNamePrompt,
  showJoinError,
  showRoomInfo,
  showMainMenu,
  showHowToPlay,
} from "./ui/overlay";

async function main() {
  const appEl = document.getElementById("app")!;
  const params = new URLSearchParams(location.search);
  const roomCodeParam = params.get("room");
  const isStreamerMode = params.get("streamer") === "1";

  if (isStreamerMode) {
    showStreamerSetup(({ streamerName, whitelist, friendlyFire }) => {
      showClassSelect(async (classId) => {
        const network = new NetworkManager();
        const roomCode = generateRoomCode();
        try {
          const room = await network.createStreamerRoom({ roomCode, streamerName, friendlyFire, whitelist, classId });
          const joinUrl = `${location.origin}${location.pathname}?room=${roomCode}`;
          showRoomInfo(roomCode, joinUrl);
          new GameScene(room, appEl, { isCommander: true });
        } catch (err) {
          console.error("Error creando la sala de streamer", err);
          showJoinError("No se pudo crear la sala. Revisá la consola para más detalles.");
        }
      });
    });
    return;
  }

  if (roomCodeParam) {
    showViewerNamePrompt(roomCodeParam, (displayName) => {
      showClassSelect(async (classId) => {
        const network = new NetworkManager();
        try {
          const room = await network.joinStreamerRoom(roomCodeParam, displayName, classId);
          new GameScene(room, appEl, { isCommander: false });
        } catch (err) {
          console.error("Error uniéndose a la sala de streamer", err);
          showJoinError("Tu nombre no está en la whitelist de esta sala, o el código es inválido.");
        }
      });
    });
    return;
  }

  const startClassSelect = () => {
    showClassSelect(async (classId) => {
      const network = new NetworkManager();
      const room = await network.connect(classId);
      new GameScene(room, appEl, { isCommander: false });
    });
  };

  const openMainMenu = () => {
    showMainMenu(startClassSelect, () => showHowToPlay(openMainMenu));
  };
  openMainMenu();
}

main().catch((err) => {
  console.error("Error iniciando el juego", err);
});
