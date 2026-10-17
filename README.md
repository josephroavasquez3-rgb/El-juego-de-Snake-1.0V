# Snake: modo local y salas online

## Uso local

Abre `index.html` directamente o publica los archivos estáticos. El modo individual y los perfiles no llaman a un servidor. El progreso vive en `localStorage` del navegador y dispositivo actuales; borrar los datos del navegador lo elimina y no hay sincronización entre dispositivos.

## Servidor de salas actual

Requiere Node.js 18 o posterior:

```powershell
npm install
npm start
```

`server/server.js` entrega los archivos del juego y expone `/socket` con la biblioteca `ws`. Dos jugadores pueden crear/unirse a una sala de cinco caracteres. El servidor mantiene la sala en memoria, ejecuta las colisiones y comparte comida, serpientes y puntuación. Las salas se limitan a dos jugadores y no sobreviven al reinicio del proceso.

En la misma red, abre `http://IP-LAN-DEL-PC:3000` desde el segundo dispositivo y permite Node.js en el firewall privado. Para jugar entre redes distintas, este proceso necesita estar publicado en un host accesible desde Internet; `localhost` y una IP LAN no bastan.

## Propuesta para publicarlo

La opción conservadora para este proyecto es mantener Node.js y `ws`: ya existe un servidor autoritativo y el tráfico es pequeño. Socket.IO añadiría reconexión, salas y fallbacks, pero no es necesario para el protocolo actual. Un cliente estático puede alojarse por separado, aunque servir cliente y WebSocket desde el mismo host simplifica HTTPS, dominios y configuración.

Flujo recomendado:

1. Publicar la carpeta estática y el proceso Node.js detrás de un dominio con HTTPS; el navegador conectará por WSS.
2. Crear una sala en el servidor y devolver un código aleatorio; la sala vive en memoria con expiración y máximo de dos plazas.
3. El invitado envía ese código desde otro dispositivo; el servidor valida la sala y comienza la ronda al tener dos jugadores.
4. Los clientes envían direcciones, no posiciones. El servidor avanza el juego a intervalos fijos y es la autoridad para colisiones, comida, obstáculos y puntuaciones.
5. El servidor publica snapshots a ambos clientes. El cliente interpola solo la representación visual y muestra el resultado cuando la sala termina.

Ya están implementados el WebSocket, salas de dos, código de invitación, movimiento autoritativo, comida, puntuación, colisiones y resultado. Lo que falta para jugar desde redes distintas es desplegar y endurecer el proceso público; también conviene añadir latidos, reconexión, expiración de salas, límites por IP y controles de abuso antes de abrirlo a cualquiera. No se usa autenticación ni se guarda progreso multijugador en el servidor.

Para probarlo entre dos redes, despliega el servidor y cliente, comparte la URL HTTPS pública y abre el juego en dos dispositivos con redes distintas (por ejemplo, Wi-Fi y datos móviles). Una prueba por IP LAN solo valida dispositivos en la misma red. No expongas el servidor de desarrollo directamente sin TLS, límites y monitorización.

## Costes orientativos

- Prueba privada: coste cero al ejecutar Node en un PC y conectar dispositivos en la misma red.
- Demo temporal: un túnel HTTPS puede servir para pruebas puntuales; no es un alojamiento de producción.
- Hosting con nivel gratuito: puede costar cero mientras cumpla las cuotas, aunque algunos proveedores suspenden procesos inactivos y eso corta WebSockets.
- Servicio Node siempre activo o VPS pequeño: normalmente unos pocos dólares al mes; dominio opcional con renovación anual. Precios, límites de tráfico y soporte WebSocket dependen del proveedor.

Para mantener presupuesto mínimo, empieza con un nivel gratuito que admita WebSockets, prueba una sesión de dos clientes externos y mide estabilidad antes de pagar capacidad permanente. Mantén el modo individual fuera de esa dependencia: una caída de este servidor solo debe desactivar salas online.
