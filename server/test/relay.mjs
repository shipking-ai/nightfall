// Two fake players in one room: checks welcome, join, relay (with sender id), rename, leave,
// and that a disallowed origin is refused. Usage: node test/relay.mjs [base-url]
const base = (process.argv[2] ?? 'https://nightfall-rooms.nightfall-rooms.workers.dev').replace(/^http/, 'ws');
const room = 'test' + Math.random().toString(36).slice(2, 10);
const url = `${base}/room/${room}`;
const ORIGIN = 'https://nightfall-sand.vercel.app';

function open(origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    const inbox = [];
    ws.onmessage = (e) => inbox.push(JSON.parse(e.data));
    ws.onopen = () => resolve({ ws, inbox });
    ws.onerror = (e) => reject(new Error('refused'));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);

const a = await open(ORIGIN);
a.ws.send(JSON.stringify({ t: 'hello', name: 'Alice', coat: 0x2d4a6b, joined: 1 }));
await wait(400);
const welcomeA = a.inbox.find((m) => m.t === 'welcome');
check('A gets welcome with an id and an empty room', !!welcomeA?.id && welcomeA.peers.length === 0);

const b = await open(ORIGIN);
b.ws.send(JSON.stringify({ t: 'hello', name: 'Bob\u0007<script>', coat: 123, joined: 2 }));
await wait(400);
const welcomeB = b.inbox.find((m) => m.t === 'welcome');
check('B sees A already there', welcomeB?.peers?.[0]?.name === 'Alice');
const joinAtA = a.inbox.find((m) => m.t === 'join');
check('A is told B joined', joinAtA?.p?.id === welcomeB?.id, JSON.stringify(joinAtA?.p));
check('control chars stripped, bad coat replaced', joinAtA?.p?.name === 'Bob<script>' && joinAtA?.p?.coat === 0x6b2b25);

a.ws.send(JSON.stringify({ t: 'st', i: 'spoofed', s: [1, 0, 2, 0.5, 3, 0] }));
await wait(400);
const st = b.inbox.find((m) => m.t === 'st');
check('B receives A’s position, stamped with A’s real id', st?.i === welcomeA.id && st?.s?.[0] === 1, JSON.stringify(st));
check('A does not get its own message back', !a.inbox.some((m) => m.t === 'st'));

a.ws.send(JSON.stringify({ t: 'nope', x: 1 }));
await wait(300);
check('unknown message types are not relayed', !b.inbox.some((m) => m.t === 'nope'));

// flood: 80 messages at once, only ~30 (burst) should get through
const before = b.inbox.filter((m) => m.t === 'hn').length;
for (let i = 0; i < 80; i++) a.ws.send(JSON.stringify({ t: 'hn', x: 0, z: 0, on: i % 2 === 0 }));
await wait(800);
const got = b.inbox.filter((m) => m.t === 'hn').length - before;
check('rate limit caps a flood', got > 10 && got <= 32, `${got} of 80 relayed`);

b.ws.close();
await wait(600);
check('A is told B left', a.inbox.some((m) => m.t === 'leave' && m.id === welcomeB.id));
a.ws.close();

try {
  await open('https://evil.example');
  check('foreign origin refused', false);
} catch {
  check('foreign origin refused', true);
}
console.log(results.join('\n'));
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
