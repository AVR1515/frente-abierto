import { Client, Room } from "colyseus.js";

const BOT_COUNT = Number(process.argv[2] ?? 10);
const DURATION_MS = Number(process.argv[3] ?? 30000);
const SERVER_URL = process.env.SERVER_URL ?? "ws://localhost:2567";
const CLASS_IDS = ["assault", "engineer", "sniper", "medic", "pilot"];

async function spawnBot(index: number): Promise<() => void> {
  const client = new Client(SERVER_URL);
  const classId = CLASS_IDS[index % CLASS_IDS.length];
  const room: Room = await client.joinOrCreate("game", { classId });
  console.log(`bot ${index} conectado (${room.sessionId}, ${classId})`);

  let seq = 0;
  const interval = setInterval(() => {
    const angle = Math.random() * Math.PI * 2;
    room.send("input", {
      moveX: Math.cos(angle),
      moveY: Math.sin(angle),
      angle,
      seq: seq++,
    });
    if (Math.random() < 0.1) room.send("shoot", { angle });
  }, 1000 / 20);

  room.onError((code, message) => console.error(`bot ${index} error`, code, message));

  return () => {
    clearInterval(interval);
    room.leave();
  };
}

async function main() {
  console.log(`Lanzando ${BOT_COUNT} bots contra ${SERVER_URL} durante ${DURATION_MS}ms...`);

  const stoppers: (() => void)[] = [];
  for (let i = 0; i < BOT_COUNT; i++) {
    try {
      stoppers.push(await spawnBot(i));
    } catch (err) {
      console.error(`No se pudo conectar el bot ${i}`, err);
    }
    // escalonar las conexiones para no saturar el handshake WS de una sola vez
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`${stoppers.length}/${BOT_COUNT} bots conectados. Corriendo la prueba...`);
  await new Promise((r) => setTimeout(r, DURATION_MS));

  stoppers.forEach((stop) => stop());
  console.log("Prueba de carga finalizada.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
