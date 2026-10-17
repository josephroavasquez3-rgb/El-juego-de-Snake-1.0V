const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const GRID = { width: 24, height: 16 };
const ROOMS = new Map();
const AVATARS = new Set(['🐍', '🦊', '🐸', '🐼', '🐙', '🐯', '🦄', '🤖']);
const SNAKE_SKINS = new Set(['classic', 'neon', 'fire', 'ice', 'plasma', 'cyber', 'ghost', 'lava', 'gold', 'galaxy',
    'spiderman', 'ironman', 'captain', 'thor', 'panther', 'deadpool', 'hulk', 'wolverine',
    'batman', 'superman', 'wonder', 'flash', 'lantern', 'aquaman', 'cyborg', 'joker']);
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.webp': 'image/webp'
};

function send(socket, payload) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function sendRoomError(socket, message) {
    send(socket, { type: 'room-error', message });
}

function safePlayer(data, client = null) {
    const name = String(data?.name ?? 'Jugador').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 18) || 'Jugador';
    const avatar = AVATARS.has(data?.avatar) ? data.avatar : '🐍';
    const skin = SNAKE_SKINS.has(data?.skin) ? data.skin : 'classic';
    return { id: crypto.randomUUID(), client, name, avatar, skin, snake: [], direction: { x: 1, y: 0 }, score: 0, alive: true };
}

function createRoomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    do {
        code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    } while (ROOMS.has(code));
    return code;
}

function roomPlayers(room) {
    return [...room.players.values()].map(({ id, name, avatar, skin, score, alive }) => ({ id, name, avatar, skin, score, alive, connected: true }));
}

function snapshot(room) {
    return {
        width: GRID.width,
        height: GRID.height,
        status: room.status,
        startedAt: room.startedAt ?? null,
        endedAt: room.endedAt ?? null,
        durationMs: room.startedAt ? (room.endedAt ?? Date.now()) - room.startedAt : 0,
        food: room.state?.food ?? null,
        winnerId: room.state?.winnerId ?? null,
        players: [...room.players.values()].map(({ id, name, avatar, skin, snake, score, alive }) => ({ id, name, avatar, skin, snake, score, alive, connected: true }))
    };
}

function broadcast(room, type = 'room-update') {
    const message = { type, roomCode: room.code, state: snapshot(room), players: roomPlayers(room), hostId: room.hostId };
    for (const socket of room.clients) send(socket, { ...message, playerId: socket.playerId });
}

function randomFood(room) {
    const occupied = new Set([...room.players.values()].flatMap(player => player.snake.map(tile => `${tile.x},${tile.y}`)));
    const free = [];
    for (let y = 0; y < GRID.height; y += 1) {
        for (let x = 0; x < GRID.width; x += 1) {
            if (!occupied.has(`${x},${y}`)) free.push({ x, y });
        }
    }
    return free.length ? free[crypto.randomInt(free.length)] : null;
}

function startRoom(room) {
    if (room.players.size !== 2 || room.status !== 'waiting') return false;
    const players = [...room.players.values()];
    players[0].snake = [{ x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }];
    players[0].direction = { x: 1, y: 0 };
    players[1].snake = [{ x: 20, y: 7 }, { x: 21, y: 7 }, { x: 22, y: 7 }];
    players[1].direction = { x: -1, y: 0 };
    room.status = 'playing';
    room.startedAt = Date.now();
    room.endedAt = null;
    room.state = { food: randomFood(room), winnerId: null };
    broadcast(room, 'room-joined');
    room.timer = setInterval(() => tickRoom(room), 125);
    return true;
}

function returnRoomToLobby(room) {
    clearInterval(room.timer);
    room.timer = null;
    room.status = 'waiting';
    room.startedAt = null;
    room.endedAt = null;
    room.state = null;
    for (const player of room.players.values()) {
        player.snake = [];
        player.direction = { x: 1, y: 0 };
        player.score = 0;
        player.alive = true;
    }
    broadcast(room, 'room-lobby');
}

function tickRoom(room) {
    if (room.status !== 'playing') return;
    for (const player of room.players.values()) {
        if (!player.alive) continue;
        const next = { x: player.snake[0].x + player.direction.x, y: player.snake[0].y + player.direction.y };
        const eating = room.state.food && next.x === room.state.food.x && next.y === room.state.food.y;
        const ownBody = eating ? player.snake : player.snake.slice(0, -1);
        const opponentBody = [...room.players.values()].filter(other => other.id !== player.id).flatMap(other => other.snake);
        const hitWall = next.x < 0 || next.y < 0 || next.x >= GRID.width || next.y >= GRID.height;
        const hitBody = [...ownBody, ...opponentBody].some(tile => tile.x === next.x && tile.y === next.y);
        if (hitWall || hitBody) {
            player.alive = false;
            continue;
        }
        player.snake.unshift(next);
        if (eating) {
            player.score += 10;
            room.state.food = randomFood(room);
        } else {
            player.snake.pop();
        }
    }
    const alive = [...room.players.values()].filter(player => player.alive);
    if (alive.length <= 1) {
        room.status = 'gameover';
        room.endedAt = Date.now();
        room.state.winnerId = alive[0]?.id ?? null;
        clearInterval(room.timer);
        room.timer = null;
    }
    broadcast(room);
}

function leaveRoom(socket) {
    const code = socket.roomCode;
    if (!code) return;
    socket.roomCode = null;
    const room = ROOMS.get(code);
    if (!room) return;
    room.clients.delete(socket);
    if (room.clients.size === 0) {
        clearInterval(room.timer);
        ROOMS.delete(code);
        return;
    }
    clearInterval(room.timer);
    room.status = 'closed';
    const remainingPlayers = roomPlayers(room).filter(player => player.id !== socket.playerId);
    for (const client of room.clients) send(client, { type: 'player-left', roomCode: code, players: remainingPlayers });
    ROOMS.delete(code);
}

function handleMessage(socket, message) {
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'create-room') {
        leaveRoom(socket);
        const code = createRoomCode();
        const room = { code, clients: new Set([socket]), players: new Map(), status: 'waiting', state: null, timer: null, hostId: null };
        const player = safePlayer(message.player, socket);
        room.players.set(player.id, player);
        room.hostId = player.id;
        socket.roomCode = code;
        socket.playerId = player.id;
        ROOMS.set(code, room);
        send(socket, { type: 'room-created', roomCode: code, players: roomPlayers(room), playerId: player.id, hostId: player.id });
        return;
    }
    if (message.type === 'join-room') {
        leaveRoom(socket);
        const code = String(message.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
        const room = ROOMS.get(code);
        if (!room) return sendRoomError(socket, 'No existe una sala con ese código.');
        if (room.status !== 'waiting' || room.players.size >= 2) return sendRoomError(socket, 'La sala ya está completa.');
        const player = safePlayer(message.player, socket);
        room.clients.add(socket);
        room.players.set(player.id, player);
        socket.roomCode = code;
        socket.playerId = player.id;
        broadcast(room, 'room-waiting');
        return;
    }
    if (message.type === 'start-room') {
        const room = ROOMS.get(socket.roomCode);
        if (!room || socket.playerId !== room.hostId) return sendRoomError(socket, 'Solo el anfitrión puede iniciar la partida.');
        if (room.players.size !== 2) return sendRoomError(socket, 'Se necesitan dos jugadores conectados para iniciar.');
        startRoom(room);
        return;
    }
    if (message.type === 'return-lobby' || message.type === 'replay-room') {
        const room = ROOMS.get(socket.roomCode);
        if (!room || room.status !== 'gameover') return sendRoomError(socket, 'La ronda ya no está disponible.');
        if (message.type === 'replay-room' && socket.playerId !== room.hostId) return sendRoomError(socket, 'Solo el anfitrión puede iniciar otra ronda.');
        returnRoomToLobby(room);
        if (message.type === 'replay-room') startRoom(room);
        return;
    }
    if (message.type === 'direction') {
        const room = ROOMS.get(socket.roomCode);
        const player = room?.players.get(socket.playerId);
        const direction = message.direction;
        if (!player || room.status !== 'playing' || !player.alive) return;
        if (![direction?.x, direction?.y].every(value => value === -1 || value === 0 || value === 1) || Math.abs(direction.x) + Math.abs(direction.y) !== 1) return;
        if (direction.x === -player.direction.x && direction.y === -player.direction.y) return;
        player.direction = { x: direction.x, y: direction.y };
        return;
    }
    if (message.type === 'leave-room') leaveRoom(socket);
}

const server = http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end('Bad request');
        return;
    }
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(ROOT, `.${requested}`);
    if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
    }
    fs.stat(filePath, (statError, stats) => {
        if (request.method === 'HEAD' && statError?.code === 'ENOENT' && pathname.startsWith('/assets/audio/')) {
            response.writeHead(204, { 'X-Snake-Optional': 'missing', 'Cache-Control': 'no-store' }).end();
            return;
        }
        if (request.method === 'HEAD' && !statError && stats.isFile()) {
            response.writeHead(200, {
                'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
                'Content-Length': stats.size,
                'Cache-Control': 'no-cache'
            }).end();
            return;
        }
        const resolvedFile = !statError && stats.isDirectory() ? path.join(filePath, 'index.html') : filePath;
        fs.readFile(resolvedFile, (error, content) => {
            if (error) {
                response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
                return;
            }
            response.writeHead(200, {
                'Content-Type': MIME_TYPES[path.extname(resolvedFile)] ?? 'application/octet-stream',
                'Cache-Control': 'no-cache',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
            });
            response.end(content);
        });
    });
});

const webSockets = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url, 'http://localhost').pathname !== '/socket') {
        socket.destroy();
        return;
    }
    webSockets.handleUpgrade(request, socket, head, client => webSockets.emit('connection', client, request));
});
webSockets.on('connection', (socket, request) => {
    socket.on('message', data => {
        try { handleMessage(socket, JSON.parse(data.toString())); }
        catch { sendRoomError(socket, 'No se pudo procesar el mensaje.'); }
    });
    socket.on('close', () => leaveRoom(socket));
});

server.listen(PORT, HOST, () => {
    console.log(`Snake listo en http://localhost:${PORT}`);
    console.log('Para otros dispositivos de la red, usa la IP LAN de este equipo.');
});

function shutdown() {
    for (const room of ROOMS.values()) clearInterval(room.timer);
    webSockets.close();
    server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);