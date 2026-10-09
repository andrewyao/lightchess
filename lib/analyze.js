// Annotates a game by running a headless Claude Code session (`claude -p`)
// with a JSON schema, then checks every suggested move for legality.
'use strict';
const { spawn } = require('child_process');
const chess = require('./chess');

const TAGS = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const NEEDS_ALTERNATIVE = ['mistake', 'blunder'];

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three short paragraphs: how the game went and the main lessons for each side.' },
    keyMoments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { ply: { type: 'integer' }, comment: { type: 'string' } },
        required: ['ply', 'comment'],
      },
    },
    moves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ply: { type: 'integer' },
          comment: { type: 'string' },
          tag: { type: ['string', 'null'], enum: [...TAGS, null] },
          bestAlternative: {
            type: ['object', 'null'],
            description: 'Required for mistakes and blunders; null otherwise.',
            properties: {
              move: { type: 'string', description: 'SAN, copied from this ply\'s legal move list.' },
              line: { type: 'string', description: 'A short likely continuation in SAN, e.g. "33.Rd2 Qf1+ 34.Kc2".' },
              why: { type: 'string', description: 'One or two sentences on why it is better than the move played.' },
            },
            required: ['move', 'line', 'why'],
          },
        },
        required: ['ply', 'comment', 'tag', 'bestAlternative'],
      },
    },
  },
  required: ['summary', 'keyMoments', 'moves'],
};

function buildPrompt(game, moves, positions) {
  const plies = moves.map((m, i) => {
    const number = `${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}`;
    const legal = chess.legalMoves(positions[i]).map((lm) => chess.toSan(positions[i], lm));
    return `ply ${i + 1}: ${number} ${m.san}\n  legal moves instead: ${legal.join(' ')}\n  FEN after: ${chess.toFen(positions[i + 1])}`;
  });
  return `You are a strong chess coach annotating a game for the players.

White: ${game.white}${game.whiteElo ? ` (rated ${game.whiteElo})` : ''}
Black: ${game.black}${game.blackElo ? ` (rated ${game.blackElo})` : ''}
Result: ${game.result} (${game.termination || 'unknown termination'})
Opening: ${game.opening || game.eco || 'unknown'}
Time control: ${game.timeControl || 'unknown'}
Start FEN: ${game.startFen}

Moves (ply numbers start at 1). Each ply lists every legal move that was available, then the FEN after the move was played. Any alternative you suggest MUST appear in that ply's legal move list. Read the board from the FEN before claiming a piece is attacked, defended or can retreat.
${plies.join('\n')}

Return:
- "moves": exactly one entry per ply, ${moves.length} in total, in order. "comment" is one or two sentences on what the move does or what it missed. Use the FENs to check tactics concretely: hanging pieces, forks, pins, checks, mating nets. "tag" is one of ${TAGS.join(', ')}, or null for routine book or forced moves. You have no engine, so only mark a move as a mistake or blunder when you can name the concrete refutation or the better move.
- For every move tagged mistake or blunder, "bestAlternative" gives the best move available at that moment. "move" is its SAN, copied exactly from that ply's legal move list. "line" is a short likely continuation. "why" says what it gains or prevents compared with the move played. Before choosing, go through the checks, captures and threats in the legal list, and compare at least two candidates. For every other move, set "bestAlternative" to null.
- "keyMoments": the 3 to 6 plies that decided the game, each with a short explanation.
- "summary": what happened and the main lessons for each side.`;
}

function runClaude(prompt, model) {
  const args = ['-p', '--output-format', 'json', '--tools', '', '--json-schema', JSON.stringify(SCHEMA)];
  if (model) args.push('--model', model);
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', (err) => reject(new Error(`Could not run claude: ${err.message}`)));
    child.on('close', (code) => {
      let envelope;
      try {
        envelope = JSON.parse(out);
      } catch {
        return reject(new Error(`claude exited ${code} with non-JSON output:\n${out.slice(0, 2000)}`));
      }
      if (envelope.is_error || !envelope.structured_output) {
        return reject(new Error(`claude failed (${envelope.subtype}): ${envelope.result}`));
      }
      resolve(envelope);
    });
    child.stdin.end(prompt);
  });
}

async function analyzeGame(game, { model } = {}) {
  const { moves, positions } = chess.replay({ fen: game.startFen, sans: chess.parsePgn(game.pgn).sans });
  const envelope = await runClaude(buildPrompt(game, moves, positions), model);
  const analysis = envelope.structured_output;
  const warnings = [];

  const covered = new Set(analysis.moves.map((m) => m.ply));
  const missing = moves.map((_, i) => i + 1).filter((ply) => !covered.has(ply));
  if (missing.length) warnings.push(`No comment for plies ${missing.join(', ')}`);

  // Keep only alternatives that are legal, rewritten in canonical SAN.
  for (const note of analysis.moves) {
    const before = positions[note.ply - 1];
    const alt = note.bestAlternative;
    if (alt) {
      const legal = before && chess.sanToMove(before, alt.move);
      if (legal) alt.move = legal.san;
      else {
        warnings.push(`Ply ${note.ply} alternative "${alt.move}" is not legal; dropped`);
        note.bestAlternative = null;
      }
    }
    if (NEEDS_ALTERNATIVE.includes(note.tag) && !note.bestAlternative) {
      warnings.push(`Ply ${note.ply} is a ${note.tag} with no valid alternative`);
    }
  }

  return {
    ...analysis,
    warnings,
    model: Object.keys(envelope.modelUsage || {})[0],
    costUsd: envelope.total_cost_usd,
    createdAt: new Date().toISOString(),
  };
}

module.exports = { analyzeGame };
