import { Schema, type } from "@colyseus/schema";

export class ControlPoint extends Schema {
  @type("string") id = "";
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") radius = 0;
  @type("number") captureValue = 0; // -1 (rojo) .. 1 (azul)
  @type("string") ownerTeam = "neutral"; // "neutral" | "red" | "blue"
}
