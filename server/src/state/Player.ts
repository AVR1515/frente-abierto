import { Schema, ArraySchema, type } from "@colyseus/schema";

export class Player extends Schema {
  @type("number") x = 0;
  @type("number") y = 0;
  @type("number") rotation = 0;
  @type("number") hp = 100;
  @type("number") maxHp = 100;
  @type("string") classId = "assault";
  @type("string") team = "red";
  @type("string") vehicleId = "";
  @type("number") level = 1;
  @type("number") xp = 0;
  @type("number") pendingEvolutionLevel = 0;
  @type(["string"]) chosenEvolutions = new ArraySchema<string>();
  @type("number") lastProcessedSeq = 0;
  @type("boolean") isBot = false;
}
