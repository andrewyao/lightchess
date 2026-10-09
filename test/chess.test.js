'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const chess = require('../lib/chess');

const at = (pos, name) => pos.board[chess.squareIndex(name)];
const play = (sans, fen) => chess.replay({ fen, sans });
const last = ({ positions }) => positions[positions.length - 1];

test('start position has 20 legal moves', () => {
  assert.strictEqual(chess.legalMoves(chess.parseFen(chess.START_FEN)).length, 20);
});

test('FEN round-trips', () => {
  const fen = 'r3k2r/pp3ppp/8/3pP3/8/8/PP3PPP/R3K2R w Kq d6 0 15';
  assert.strictEqual(chess.toFen(chess.parseFen(fen)), fen);
});

test('detects checkmate in SAN', () => {
  const { moves } = play(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']);
  assert.strictEqual(moves[6].san, 'Qxf7#');
  assert.strictEqual(play(['e4', 'f5', 'Qh5+']).moves[2].san, 'Qh5+');
});

test('castling moves the rook on both wings', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const short = last(play(['O-O'], fen));
  assert.strictEqual(at(short, 'g1'), 'K');
  assert.strictEqual(at(short, 'f1'), 'R');
  assert.strictEqual(short.castling, 'kq');
  const long = last(play(['O-O', 'O-O-O'], fen));
  assert.strictEqual(at(long, 'c8'), 'k');
  assert.strictEqual(at(long, 'd8'), 'r');
});

test('cannot castle through an attacked square', () => {
  const pos = chess.parseFen('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
  assert.strictEqual(chess.sanToMove(pos, 'O-O'), null);
  assert.ok(chess.sanToMove(pos, 'O-O-O'));
});

test('en passant removes the captured pawn', () => {
  const pos = last(play(['e4', 'a6', 'e5', 'd5', 'exd6']));
  assert.strictEqual(at(pos, 'd6'), 'P');
  assert.strictEqual(at(pos, 'd5'), null);
});

test('promotion to the named piece', () => {
  const { moves, positions } = play(['a8=N'], '8/P7/8/8/8/8/8/k6K w - - 0 1');
  assert.strictEqual(moves[0].san, 'a8=N');
  assert.strictEqual(at(positions[1], 'a8'), 'N');
});

test('disambiguates by file, then rank', () => {
  assert.strictEqual(play(['Rad1'], 'k7/8/8/8/8/8/8/R4RK1 w - - 0 1').moves[0].san, 'Rad1');
  assert.strictEqual(play(['R1a3'], '7k/8/8/R7/8/8/8/R5K1 w - - 0 1').moves[0].san, 'R1a3');
});

test('parsePgn strips headers, clock comments and move numbers', () => {
  const { headers, sans } = chess.parsePgn('[White "a"]\n[Result "1-0"]\n\n1. e4 {[%clk 0:15:00]} 1... e5 (1... c5 2. Nf3) 2. Nf3 1-0');
  assert.strictEqual(headers.White, 'a');
  assert.deepStrictEqual(sans, ['e4', 'e5', 'Nf3']);
});

test('replays chess.com game 185034709812 to its final position', () => {
  const pgn = fs.readFileSync(path.join(__dirname, 'fixtures', '185034709812.pgn'), 'utf8');
  const result = play(chess.parsePgn(pgn).sans);
  assert.strictEqual(result.moves.length, 66);
  assert.strictEqual(result.moves[65].san, 'Qxc2#');
  assert.strictEqual(
    chess.toFen(last(result)).split(' ').slice(0, 3).join(' '),
    '5Q2/2rk1p2/2p1p3/1p1pPn2/3P2p1/P2R2P1/1Pq4r/3KR3 w -',
  );
});

test('decodes chess.com TCN to the same moves as the PGN', () => {
  const tcn = fs.readFileSync(path.join(__dirname, 'fixtures', '185034709812.tcn'), 'utf8').trim();
  const pgn = fs.readFileSync(path.join(__dirname, 'fixtures', '185034709812.pgn'), 'utf8');
  assert.deepStrictEqual(chess.movesToSans(chess.START_FEN, chess.decodeTcn(tcn)), chess.parsePgn(pgn).sans);
});

test('decodes TCN promotions', () => {
  const T = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=';
  // a7 (48) promotes straight ahead to a knight: 64 + 3 * 1 (n) + 1 (straight).
  const [move] = chess.decodeTcn(T[48] + T[68]);
  assert.deepStrictEqual(move, { from: 48, to: 56, promo: 'n' });
  assert.deepStrictEqual(chess.movesToSans('8/P7/8/8/8/8/8/k6K w - - 0 1', [move]), ['a8=N']);
});

test('parsePgn reads %clk comments as tenths of a second', () => {
  const pgn = fs.readFileSync(path.join(__dirname, 'fixtures', '185034709812.pgn'), 'utf8');
  const { sans, clocks } = chess.parsePgn(pgn);
  assert.strictEqual(clocks.length, sans.length);
  assert.deepStrictEqual(clocks.slice(0, 3), [9100, 9100, 9123]);
  assert.deepStrictEqual(clocks.slice(-2), [5878, 4194]); // 9:47.8 and 6:59.4
  assert.deepStrictEqual(chess.parsePgn('1. e4 e5 2. Nf3 *').clocks, [null, null, null]);
});
