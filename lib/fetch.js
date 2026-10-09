// Downloads a game by id from chess.com's internal game endpoint
// (www.chess.com/callback/<live|daily>/game/<id>). It's undocumented and may
// change without notice, but it needs only the game id.
'use strict';
const chess = require('./chess');
const { writeGame } = require('./store');

const USER_AGENT = 'Mozilla/5.0 (lightchess; personal game replay tool)';

// Accepts a bare id or a chess.com game link, e.g.
// https://www.chess.com/game/live/185034709812?move=12
function parseGameInput(input) {
  const text = String(input || '').trim();
  const id = (text.match(/(?:^|\/)(\d{4,})\/?(?:[?#].*)?$/) || [])[1];
  return id && { id, kind: /\/daily\//.test(text) ? 'daily' : /\/live\//.test(text) ? 'live' : null };
}

async function getGameData(kind, id) {
  const res = await fetch(`https://www.chess.com/callback/${kind}/game/${id}`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`chess.com returned ${res.status} for game ${id}`);
  const data = await res.json();
  return data?.game?.moveList !== undefined ? data.game : null;
}

// Tenths of a second -> PGN clock comment, e.g. 5878 -> {[%clk 0:09:47.8]}.
function clockComment(ds) {
  const h = Math.floor(ds / 36000);
  const m = Math.floor((ds % 36000) / 600);
  const s = (ds % 600) / 10;
  return `{[%clk ${h}:${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}]}`;
}

function buildPgn(headers, sans, clocks) {
  const tags = Object.entries(headers).filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `[${k} "${String(v).replace(/"/g, "'")}"]`);
  const moves = sans.map((san, i) => (i % 2 ? `${i / 2 + 0.5}... ` : `${i / 2 + 1}. `) + san
    + (Number.isFinite(clocks[i]) ? ` ${clockComment(clocks[i])}` : '')).join(' ');
  return `${tags.join('\n')}\n\n${moves} ${headers.Result || '*'}\n`;
}

// `kind` is 'live', 'daily', or null to try live first, then daily.
async function fetchGame(id, kind = null) {
  let game = null;
  for (const k of kind ? [kind] : ['live', 'daily']) {
    game = await getGameData(k, id);
    if (game) { kind = k; break; }
  }
  if (!game) throw new Error(`chess.com has no game ${id}`);
  if (game.type && game.type !== 'chess') throw new Error(`Game ${id} is ${game.typeName || game.type}, not standard chess`);

  const h = game.pgnHeaders || {};
  const startFen = h.FEN || chess.START_FEN;
  const sans = chess.movesToSans(startFen, chess.decodeTcn(game.moveList));
  if (game.plyCount !== undefined && game.plyCount !== sans.length) {
    throw new Error(`Decoded ${sans.length} moves but chess.com reports ${game.plyCount}`);
  }
  const { positions } = chess.replay({ fen: startFen, sans });
  // Remaining clock after each move, in tenths of a second (live games only).
  const clocks = game.moveTimestamps ? String(game.moveTimestamps).split(',').slice(0, sans.length).map(Number) : [];

  const headers = {
    Event: h.Event, Site: 'Chess.com', Date: h.Date, White: h.White, Black: h.Black, Result: h.Result,
    WhiteElo: h.WhiteElo, BlackElo: h.BlackElo,
    ECO: h.ECO, TimeControl: h.TimeControl, Termination: h.Termination,
    ...(h.FEN && h.FEN !== chess.START_FEN ? { SetUp: '1', FEN: h.FEN } : {}),
  };
  const record = {
    id,
    url: `https://www.chess.com/game/${kind}/${id}`,
    white: h.White,
    black: h.Black,
    whiteElo: h.WhiteElo,
    blackElo: h.BlackElo,
    result: h.Result,
    termination: h.Termination || game.resultMessage,
    date: (h.Date || '').replace(/\./g, '-'),
    timeControl: h.TimeControl,
    eco: h.ECO,
    startFen,
    finalFen: chess.toFen(positions[positions.length - 1]),
    pgn: buildPgn(headers, sans, clocks),
  };
  writeGame(record);
  return { record, plies: sans.length };
}

module.exports = { fetchGame, parseGameInput };
