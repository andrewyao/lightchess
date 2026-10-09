// Game files live in games/ twice: as plain JSON, and as a script that
// assigns the same data onto `window`, so index.html works from file://
// (browsers block fetch() of local files but allow <script src>).
'use strict';
const fs = require('fs');
const path = require('path');

const GAMES_DIR = path.join(__dirname, '..', 'games');

function write(name, globalName, key, data) {
  fs.mkdirSync(GAMES_DIR, { recursive: true });
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(GAMES_DIR, `${name}.json`), json + '\n');
  fs.writeFileSync(
    path.join(GAMES_DIR, `${name}.js`),
    `(window.${globalName} = window.${globalName} || {})[${JSON.stringify(key)}] = ${json};\n`,
  );
}

function readGame(id) {
  const file = path.join(GAMES_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`No game ${id} in games/. Run: node fetch-game.js <user> ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeGame(game) {
  write(game.id, 'LIGHTCHESS_GAMES', game.id, game);
  const index = fs.readdirSync(GAMES_DIR)
    .filter((f) => /^\d+\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(GAMES_DIR, f), 'utf8')))
    .map(({ id, url, white, black, whiteElo, blackElo, result, date, opening, eco }) =>
      ({ id, url, white, black, whiteElo, blackElo, result, date, opening, eco }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  fs.writeFileSync(path.join(GAMES_DIR, 'index.js'), `window.LIGHTCHESS_INDEX = ${JSON.stringify(index, null, 2)};\n`);
}

module.exports = { GAMES_DIR, readGame, writeGame };
