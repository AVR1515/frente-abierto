import express from "express";
import { createServer } from "http";
import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom";
import { StreamerRoom } from "./rooms/StreamerRoom";

const port = Number(process.env.PORT) || 2567;

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  server: httpServer,
});

gameServer.define("game", GameRoom);
gameServer.define("streamer_game", StreamerRoom).filterBy(["roomCode"]);

httpServer.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});
