# Guía de construcción: shooter 2D estilo Battlefield con progresión diep.io

2026-09-16 · @u_cTKc3N_b2nf89E9rn0tTfQ

## Resumen del proyecto

El objetivo es construir **Frente Abierto** (nombre de trabajo), un shooter 2D top-down multijugador para navegador que combina el movimiento y disparo arcade de diep.io con la estructura de combate por equipos de Battlefield/Ravenfield.

- Vista y control: cámara top-down que sigue al jugador, movimiento con WASD y apuntado con el mouse, física arcade (sin precisión pixel-perfect).
- Núcleo de partida: equipos peleando por puntos de control (modo Conquista), no "sobrevive y crece" como en un .io clásico.
- Progresión dentro de la partida: subir de nivel mejora la clase o el vehículo del jugador, visual y estadísticamente, pero morir solo cuesta uno o dos niveles, no todo el progreso.
- Audiencia adicional: streamers deben poder hospedar servidores privados para que jueguen sus suscriptores, con un rol especial de "Comandante" alimentado por el chat.

**Instrucciones para la IA que construya esto:** avanzá fase por fase, en el orden de este documento, sin saltarte ninguna. No empieces la fase siguiente hasta que la actual funcione de punta a punta (cliente + servidor conectados) y cumpla su criterio de aceptación (ver la última sección del documento). Cada fase debe dejar el juego en un estado jugable, aunque sea reducido — nunca dejes código a medio conectar entre fases.

## Fase 0 — Stack técnico y entorno

Usá TypeScript en todo el proyecto (cliente, servidor y código compartido) para compartir tipos y evitar bugs de sincronización. Recomendación concreta de librerías:

- Servidor: **Colyseus** (sobre WebSockets) para manejar salas, sesiones y sincronización de estado automática — esto va a ser clave más adelante para las salas de streamers.
- Cliente: **PixiJS** (renderizado 2D por WebGL) + **Vite** como bundler y servidor de desarrollo.
- Física: colisiones propias círculo-círculo y círculo-rectángulo a mano; no hace falta un motor de física completo todavía (se puede evaluar matter.js recién en la Fase 6, vehículos).

Estructura de carpetas (monorepo con npm workspaces):

```
/frente-abierto
  /server
    src/rooms/
    src/state/
    src/index.ts
    package.json
  /client
    src/scenes/
    src/net/
    src/main.ts
    package.json
  /shared
    types.ts
    constants.ts
  package.json
```

Comandos iniciales: `npm init -y` en la raíz con `"workspaces": ["server", "client", "shared"]`; en `/server`, `npm install colyseus @colyseus/schema express`; en `/client`, `npm install pixi.js colyseus.js` y `npm install -D vite typescript`.

**Criterio de aceptación de esta fase:** el servidor arranca y loguea que está escuchando en un puerto (por ejemplo 2567); el cliente corre con `vite dev`, muestra un canvas de Pixi en blanco y logra conectarse por WebSocket al servidor (basta con loguear "cliente conectado" en ambos lados). Todavía no hay jugabilidad.

## Fase 1 — Esqueleto del servidor autoritativo

Regla central de todo el proyecto: **el servidor manda**. El cliente nunca decide su propia posición final ni si un disparo impactó; solo envía intención (input) y el servidor calcula el resultado. Esto evita cheats obvios y es la base de cómo funcionan Battlefield y cualquier shooter competitivo real.

Pasos concretos:

1. Creá una `Room` de Colyseus (`GameRoom`) con un schema de estado (`@colyseus/schema`) que incluya un `MapSchema<Player>`, y cada `Player` con `x`, `y`, `rotation`, `hp`, `classId`, `level`.
2. Implementá `onJoin` (crea el Player en el estado, lo ubica en un punto de spawn) y `onLeave` (lo remueve).
3. Montá un loop de simulación de tick fijo con `this.setSimulationInterval(() => this.update(deltaTime), 1000/30)` (30 Hz es un buen punto de partida).
4. Manejá mensajes de input (`room.onMessage('input', ...)`) que solo contengan el vector de movimiento y el ángulo de apuntado — nunca coordenadas absolutas del cliente.
5. En cada tick, aplicá el último input recibido de cada jugador para mover su posición, validándola contra los límites del mapa.

Colyseus sincroniza el estado automáticamente a todos los clientes conectados a la sala; no hace falta escribir tu propio protocolo de serialización.

**Criterio de aceptación:** dos pestañas del navegador conectadas a la misma sala ven, en los logs del servidor, que ambos jugadores existen en el estado compartido con posiciones que cambian cuando cada una envía input (todavía sin render en el cliente, eso es la Fase 2).

## Fase 2 — Cliente básico: render, cámara y movimiento

Inicializá una `PIXI.Application` a pantalla completa. Representá a cada jugador como un `Container` simple (un triángulo o círculo de color, sin arte final todavía) dentro de un `worldContainer` que contiene todo el mapa.

- Cámara: no muevás una cámara real — muevé el `worldContainer` en la dirección opuesta a la posición del jugador local, centrado en la pantalla. Así simulás que la cámara sigue al jugador.
- Input: escuchá teclado (WASD) para armar un vector de movimiento normalizado, y la posición del mouse relativa al jugador (que está siempre en el centro de pantalla) para calcular el ángulo de apuntado.
- Enviá ese input al servidor a una tasa fija (por ejemplo cada 50ms), nunca en cada frame de render — desacoplá el loop de render (`requestAnimationFrame`, vía el ticker de Pixi) del loop de envío de input.
- Interpolación: para los jugadores remotos, no saltes directo a la posición que llega del servidor; interpolá (lerp) entre la posición anterior y la nueva en cada frame para que el movimiento se vea fluido y no a saltos.

**Criterio de aceptación:** dos pestañas conectadas ven, cada una, su propio jugador moviéndose con WASD y al otro jugador moviéndose de forma fluida en pantalla, con la cámara de cada cliente centrada en su propio jugador.

## Fase 3 — Combate: disparo, proyectiles y colisiones

El cliente envía un mensaje `shoot` con el ángulo de apuntado actual; nunca envía "le pegó a X jugador", eso lo decide siempre el servidor.

- Al recibir `shoot`, el servidor valida un cooldown según el arma de la clase (rechaza el disparo si no pasó suficiente tiempo desde el último) y agrega un proyectil al estado de la sala, con posición inicial, dirección y velocidad según los stats del arma.
- En cada tick del loop de simulación, mové cada proyectil y chequé colisión círculo-círculo contra todos los jugadores enemigos cercanos (usar una grilla simple para no comparar contra todo el mapa, ver Fase 8 para la versión optimizada).
- Al impactar, reducí el HP del jugador golpeado en el estado, remové el proyectil, y emití un evento (`room.broadcast('hit', {...})`) para que los clientes muestren feedback visual y sonoro sin tener que esperar al próximo snapshot de estado.
- Cuando el HP llega a 0: respawn del jugador en un punto de spawn de su equipo, con penalidad de uno o dos niveles (ver Fase 4).

**Criterio de aceptación:** un jugador puede disparar, el proyectil viaja visualmente en ambos clientes, y al impactar a otro jugador su HP baja de forma consistente en las dos pantallas (sin desincronización) hasta provocar su muerte y respawn.

## Fase 4 — Clases y progresión estilo diep.io

Definí las clases jugables (Asalto, Ingeniero, Francotirador, Médico/Soporte, Piloto) como objetos de configuración en `shared/constants.ts`: stats base (HP, velocidad, arma, cooldown) y un árbol de evolución por niveles, igual en espíritu al de diep.io.

- Sumá XP al jugador en el estado del servidor por matar, reparar, curar o capturar puntos (no solo por matar, para que las clases de soporte también progresen).
- En umbrales de nivel definidos, ofrecé al jugador una elección de rama (por ejemplo, a nivel 3 el Asalto elige entre "más cadencia" o "escopeta de área"). El cliente muestra un prompt simple; la elección se envía al servidor como mensaje `evolve` y el servidor la valida contra las ramas permitidas para esa clase y nivel antes de aplicarla — nunca confîs en lo que el cliente dice que eligió sin validar.
- Al subir de nivel, cambiá el sprite/forma del jugador (aunque sea con colores o tamaños distintos al principio) para que el crecimiento se note visualmente, como en diep.io.
- Al morir, restale uno o dos niveles en vez de resetear todo el progreso — la muerte debe doler pero no arruinar la partida.

**Criterio de aceptación:** un jugador que mata o cumple objetivos sube de nivel visiblemente, se le ofrece una elección de mejora en los umbrales definidos, y morir le hace perder nivel pero no lo manda a nivel 1.

## Fase 5 — Modo Conquista

Definí de 3 a 5 zonas circulares de "punto de control" en los datos del mapa (coordenadas + radio).

- Cada tick, contá cuántos jugadores de cada equipo están parados dentro de cada zona. Si un equipo tiene mayoría, deslizá gradualmente un medidor de progreso de captura hacia ese equipo (no instantáneo, para que se pueda disputar).
- Cada equipo tiene un contador de tickets (refuerzos). El equipo que controla más puntos de control hace bajar los tickets del rival más rápido cada segundo.
- Condición de victoria: los tickets de un equipo llegan a 0, o se acaba el tiempo de partida y gana el equipo con más tickets restantes.
- En el cliente, mostrá un minimapa simple con la posición de los puntos de control y su color de equipo actual, y una barra de tickets por equipo en la UI principal.

**Criterio de aceptación:** con dos equipos de prueba, capturar puntos de control acelera visiblemente la pérdida de tickets del rival, y la partida termina correctamente cuando un equipo llega a 0 tickets o se acaba el tiempo.

## Fase 6 — Vehículos

Modelá los vehículos (jeep, tanque, artillería) como entidades con estado propio en el servidor, igual de autoritativas que los jugadores: posición, rotación del chasis, HP y — en el caso del tanque — una rotación de torreta independiente del chasis.

- Un jugador "sube" a un vehículo al acercarse y enviar un mensaje `enterVehicle`; mientras está adentro, su input de movimiento controla el chasis (con inercia y radio de giro, no el movimiento instantáneo del jugador a pie) y su input de apuntado controla la torreta por separado.
- La artillería es estacionaria: no se mueve, pero tiene mucho alcance y puede bombardear zonas lejanas, incluyendo puntos de control desde fuera del combate directo.
- Los vehículos también suben de nivel mientras se usan (más blindaje, un segundo cañón), con la misma lógica de validación en servidor que la Fase 4.
- Al ser destruido, el vehículo expulsa al jugador (que reaparece a pie) y queda un tiempo de reaparición antes de que un vehículo nuevo esté disponible en su punto de spawn.

**Criterio de aceptación:** un jugador puede subir a un tanque, moverlo de forma distinta a como se mueve a pie, apuntar la torreta independientemente del chasis, y el vehículo puede ser destruido por otros jugadores.

## Fase 7 — Salas para streamers y autenticación de subs

Esta fase agrega la característica diferencial pedida al inicio: que un streamer pueda crear servidores para que jueguen sus suscriptores.

1. **Login del streamer:** implementá el flujo OAuth de Twitch (authorization code flow) en una ruta del servidor (`/auth/twitch`); al volver, guardá el token de acceso del streamer.
2. **Verificación de subs:** cuando un espectador quiere unirse a la sala, el servidor llama a la API Helix de Twitch ("Get Broadcaster Subscriptions") con el token del streamer para confirmar que ese espectador está suscripto, y arma una whitelist temporal para esa sala.
3. **Token de sesión:** emití un JWT firmado por tu servidor que el cliente guarda y envía al conectarse a la Room; en el `onAuth` de Colyseus, validá el JWT y chequé que el usuario esté en la whitelist antes de dejarlo entrar.
4. **Panel del streamer:** una página simple (puede ser parte del mismo cliente) donde el streamer configura el mapa, el modo y opciones (por ejemplo fuego amigo on/off) y genera un link de sala para compartir.
5. **Rol de Comandante (opcional pero central a la idea):** una vista aparte, liviana, para el streamer con acciones limitadas (pedir ataque de artillería, marcar el mapa) que se pagan con "puntos de comando"; esos puntos se acumulan escuchando un webhook de Twitch EventSub (subs, bits) que empuja eventos al estado de la sala.

**Criterio de aceptación:** un streamer de prueba puede loguearse, crear una sala, y solo las cuentas de Twitch marcadas como suscriptas (o una whitelist manual de prueba) logran conectarse a esa sala específica.

## Fase 8 — Netcode, rendimiento y despliegue

- **Predicción en el cliente:** para que el jugador local se sienta responsivo pese a la latencia, mové su personaje localmente de inmediato al presionar una tecla (sin esperar al servidor), guardando un historial de inputs; cuando llega la corrección del servidor, reaplicá los inputs no confirmados aún sobre la posición corregida (reconciliación).
- **Interpolación de remotos:** renderizá a los demás jugadores con un pequeño retraso (unos 100ms) para poder interpolar suavemente entre los últimos dos estados recibidos, en vez de mostrar saltos.
- **Rendimiento del servidor:** reemplazá la comparación de colisiones "todos contra todos" por una grilla espacial o quadtree, para no chequear cada proyectil contra cada jugador del mapa (eso escala mal apenas hay varios jugadores y vehículos disparando a la vez).
- **Límites:** definí un máximo de jugadores y de entidades (proyectiles, vehículos) por sala para mantener el tick rate estable.
- **Despliegue:** servidor en un host con soporte de WebSockets persistentes (Fly.io, Railway o un VPS propio); cliente estático en Vercel, Netlify o Cloudflare Pages; secretos de autenticación (client secret de Twitch, clave del JWT) en variables de entorno, nunca en el repo.
- **Prueba de carga:** antes de abrir una sala a suscriptores reales, escribí un script simple que conecte varios bots simulados a la vez para verificar que el servidor aguanta la cantidad de jugadores esperada sin que el tick rate se degrade.

**Criterio de aceptación:** una partida con al menos 8-10 jugadores reales (o bots) se siente fluida para todos, sin saltos notorios de posición, y el servidor desplegado se mantiene estable durante una partida completa.

## Checklist de aceptación por fase

Orden recomendado de entrega — no avanzar a la fila siguiente hasta cumplir la anterior.

| Fase | Qué debe funcionar | Cómo verificarlo |
| --- | --- | --- |
| 0 — Entorno | Repo montado, server y client arrancan | Servidor loguea el puerto; cliente muestra canvas y se conecta por WebSocket |
| 1 — Servidor | Estado compartido autoritativo | Dos clientes ven ambos jugadores en el estado del servidor, con posición actualizada |
| 2 — Cliente | Render, cámara e input | Movimiento fluido en ambas pantallas, cámara centrada en el jugador local |
| 3 — Combate | Disparo y daño sincronizados | El HP baja igual en ambos clientes al impactar, con respawn correcto |
| 4 — Progresión | Niveles y evolución de clase | Subir de nivel cambia stats y apariencia; elección de rama validada en servidor |
| 5 — Conquista | Puntos de control y tickets | Capturar puntos acelera la derrota del rival; la partida termina bien |
| 6 — Vehículos | Subir, conducir, torreta, destrucción | Tanque se mueve distinto a pie, torreta independiente, se puede destruir |
| 7 — Streamers | Login, whitelist de subs, sala privada | Solo cuentas suscriptas (o whitelist de prueba) entran a la sala del streamer |
| 8 — Netcode/deploy | Predicción, rendimiento, servidor en producción | Partida de 8-10 jugadores fluida y estable fuera de localhost |

Si en algún momento una fase no cumple su criterio, la IA constructora debería arreglarla antes de seguir — los bugs de sincronización cliente-servidor se acumulan y son mucho más difíciles de rastrear si se dejan pasar entre fases.
