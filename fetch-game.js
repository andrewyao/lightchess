#!/usr/bin/env node
// Usage: node fetch-game.js <game id | chess.com game URL>
'use strict';
const { fetchGame, parseGameInput } = require('./lib/fetch');

async function main() {
  const game = parseGameInput(process.argv[2]);
  if (!game) {
    console.error('Usage: node fetch-game.js <game id | chess.com game URL>');
    process.exit(1);
  }
  const { record, plies } = await fetchGame(game.id, game.kind);
  console.log(`Saved ${record.white} vs ${record.black} (${record.result}, ${plies} plies) to games/${game.id}.json`);
  const port = Number(process.env.PORT) || require('./package.json').config.port;
  console.log(`Open http://127.0.0.1:${port}/?game=${game.id} (run pnpm dev first)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
