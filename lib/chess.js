// Minimal chess rules engine: enough to replay a PGN, generate SAN, and
// detect check/mate. Squares are indexed 0..63 with a1 = 0, h1 = 7, a8 = 56.
// Pieces are FEN characters (uppercase white, lowercase black).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LightChess = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
  const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const ROOK_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const BISHOP_DIRS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

  const sq = (f, r) => f + 8 * r;
  const fileOf = (i) => i % 8;
  const rankOf = (i) => i >> 3;
  const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  const squareName = (i) => FILES[fileOf(i)] + (rankOf(i) + 1);
  const squareIndex = (name) => FILES.indexOf(name[0]) + 8 * (Number(name[1]) - 1);
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
  const typeOf = (p) => p.toLowerCase();
  const opp = (c) => (c === 'w' ? 'b' : 'w');

  function parseFen(fen) {
    const [placement, turn, castling, ep, half, full] = fen.trim().split(/\s+/);
    const board = new Array(64).fill(null);
    placement.split('/').forEach((row, i) => {
      let f = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) f += Number(ch);
        else board[sq(f++, 7 - i)] = ch;
      }
    });
    return {
      board,
      turn: turn || 'w',
      castling: castling && castling !== '-' ? castling : '',
      ep: ep && ep !== '-' ? squareIndex(ep) : -1,
      halfmove: Number(half) || 0,
      fullmove: Number(full) || 1,
    };
  }

  function toFen(pos) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = pos.board[sq(f, r)];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += p;
      }
      rows.push(empty ? row + empty : row);
    }
    return [rows.join('/'), pos.turn, pos.castling || '-',
      pos.ep >= 0 ? squareName(pos.ep) : '-', pos.halfmove, pos.fullmove].join(' ');
  }

  // Is square i attacked by any piece of color `by`?
  function attacked(board, i, by) {
    const f = fileOf(i);
    const r = rankOf(i);
    const is = (ff, rr, types) => {
      if (!onBoard(ff, rr)) return false;
      const p = board[sq(ff, rr)];
      return !!p && colorOf(p) === by && types.includes(typeOf(p));
    };
    const pawnRank = by === 'w' ? r - 1 : r + 1;
    if (is(f - 1, pawnRank, 'p') || is(f + 1, pawnRank, 'p')) return true;
    if (KNIGHT.some(([df, dr]) => is(f + df, r + dr, 'n'))) return true;
    if (KING.some(([df, dr]) => is(f + df, r + dr, 'k'))) return true;
    const ray = (dirs, types) => dirs.some(([df, dr]) => {
      for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
        const p = board[sq(ff, rr)];
        if (p) return colorOf(p) === by && types.includes(typeOf(p));
      }
      return false;
    });
    return ray(ROOK_DIRS, 'rq') || ray(BISHOP_DIRS, 'bq');
  }

  function inCheck(pos, color = pos.turn) {
    const king = pos.board.indexOf(color === 'w' ? 'K' : 'k');
    return king >= 0 && attacked(pos.board, king, opp(color));
  }

  function pseudoMoves(pos) {
    const { board, turn } = pos;
    const moves = [];
    const add = (from, to, promo) => moves.push(promo ? { from, to, promo } : { from, to });
    const isEnemy = (p) => !!p && colorOf(p) !== turn;

    for (let from = 0; from < 64; from++) {
      const p = board[from];
      if (!p || colorOf(p) !== turn) continue;
      const f = fileOf(from);
      const r = rankOf(from);
      const t = typeOf(p);

      if (t === 'p') {
        const dir = turn === 'w' ? 1 : -1;
        const startRank = turn === 'w' ? 1 : 6;
        const lastRank = turn === 'w' ? 7 : 0;
        const push = (to) => {
          if (rankOf(to) === lastRank) for (const promo of 'qrbn') add(from, to, promo);
          else add(from, to);
        };
        if (onBoard(f, r + dir) && !board[sq(f, r + dir)]) {
          push(sq(f, r + dir));
          if (r === startRank && !board[sq(f, r + 2 * dir)]) add(from, sq(f, r + 2 * dir));
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f + df, r + dir)) continue;
          const to = sq(f + df, r + dir);
          if (isEnemy(board[to]) || to === pos.ep) push(to);
        }
      } else if (t === 'n' || t === 'k') {
        for (const [df, dr] of t === 'n' ? KNIGHT : KING) {
          if (!onBoard(f + df, r + dr)) continue;
          const to = sq(f + df, r + dr);
          if (!board[to] || isEnemy(board[to])) add(from, to);
        }
      } else {
        const dirs = t === 'r' ? ROOK_DIRS : t === 'b' ? BISHOP_DIRS : ROOK_DIRS.concat(BISHOP_DIRS);
        for (const [df, dr] of dirs) {
          for (let ff = f + df, rr = r + dr; onBoard(ff, rr); ff += df, rr += dr) {
            const to = sq(ff, rr);
            if (board[to]) {
              if (isEnemy(board[to])) add(from, to);
              break;
            }
            add(from, to);
          }
        }
      }
    }

    // Castling: king and rook on home squares, path empty, king not passing
    // through check. Landing in check is filtered out by legalMoves.
    const home = turn === 'w' ? 0 : 7;
    const kingFrom = sq(4, home);
    const enemy = opp(turn);
    const own = (ch) => (turn === 'w' ? ch.toUpperCase() : ch);
    const rights = turn === 'w'
      ? pos.castling.replace(/[a-z]/g, '')
      : pos.castling.replace(/[A-Z]/g, '').toUpperCase();
    if (board[kingFrom] === own('k') && !attacked(board, kingFrom, enemy)) {
      if (rights.includes('K') && board[sq(7, home)] === own('r')
        && !board[sq(5, home)] && !board[sq(6, home)] && !attacked(board, sq(5, home), enemy)) {
        add(kingFrom, sq(6, home));
      }
      if (rights.includes('Q') && board[sq(0, home)] === own('r')
        && !board[sq(3, home)] && !board[sq(2, home)] && !board[sq(1, home)]
        && !attacked(board, sq(3, home), enemy)) {
        add(kingFrom, sq(2, home));
      }
    }
    return moves;
  }

  function applyMove(pos, move) {
    const board = pos.board.slice();
    const { from, to } = move;
    const piece = board[from];
    const t = typeOf(piece);
    let isCapture = !!board[to];

    board[to] = piece;
    board[from] = null;

    if (t === 'p') {
      if (to === pos.ep && fileOf(from) !== fileOf(to)) {
        board[to + (pos.turn === 'w' ? -8 : 8)] = null;
        isCapture = true;
      }
      if (rankOf(to) === 0 || rankOf(to) === 7) {
        const promo = move.promo || 'q';
        board[to] = pos.turn === 'w' ? promo.toUpperCase() : promo;
      }
    }
    if (t === 'k' && Math.abs(fileOf(to) - fileOf(from)) === 2) {
      const home = rankOf(from);
      const kingside = fileOf(to) === 6;
      const rookFrom = sq(kingside ? 7 : 0, home);
      board[sq(kingside ? 5 : 3, home)] = board[rookFrom];
      board[rookFrom] = null;
    }

    let castling = pos.castling;
    const strip = (chars) => { for (const c of chars) castling = castling.replace(c, ''); };
    if (piece === 'K') strip('KQ');
    if (piece === 'k') strip('kq');
    for (const s of [from, to]) {
      if (s === 0) strip('Q');
      if (s === 7) strip('K');
      if (s === 56) strip('q');
      if (s === 63) strip('k');
    }

    return {
      board,
      turn: opp(pos.turn),
      castling,
      ep: t === 'p' && Math.abs(to - from) === 16 ? (from + to) / 2 : -1,
      halfmove: t === 'p' || isCapture ? 0 : pos.halfmove + 1,
      fullmove: pos.fullmove + (pos.turn === 'b' ? 1 : 0),
    };
  }

  function legalMoves(pos) {
    return pseudoMoves(pos).filter((m) => !inCheck(applyMove(pos, m), pos.turn));
  }

  function toSan(pos, move) {
    const piece = pos.board[move.from];
    const t = typeOf(piece);
    let san;
    if (t === 'k' && Math.abs(fileOf(move.to) - fileOf(move.from)) === 2) {
      san = fileOf(move.to) === 6 ? 'O-O' : 'O-O-O';
    } else {
      const capture = !!pos.board[move.to] || (t === 'p' && fileOf(move.from) !== fileOf(move.to));
      const dest = squareName(move.to);
      if (t === 'p') {
        san = (capture ? FILES[fileOf(move.from)] + 'x' : '') + dest
          + (move.promo ? '=' + move.promo.toUpperCase() : '');
      } else {
        const rivals = legalMoves(pos).filter(
          (m) => m.to === move.to && m.from !== move.from && pos.board[m.from] === piece,
        );
        let dis = '';
        if (rivals.length) {
          if (!rivals.some((m) => fileOf(m.from) === fileOf(move.from))) dis = FILES[fileOf(move.from)];
          else if (!rivals.some((m) => rankOf(m.from) === rankOf(move.from))) dis = String(rankOf(move.from) + 1);
          else dis = squareName(move.from);
        }
        san = t.toUpperCase() + dis + (capture ? 'x' : '') + dest;
      }
    }
    const next = applyMove(pos, move);
    if (inCheck(next)) san += legalMoves(next).length ? '+' : '#';
    return san;
  }

  const bareSan = (san) => san.replace(/[+#!?]+$/, '').replace(/^0-0(-0)?$/, (s) => s.replace(/0/g, 'O'));

  // Resolve a SAN string to a legal move, or null. Returns the move with its
  // canonical SAN attached.
  function sanToMove(pos, san) {
    const want = bareSan(san);
    for (const m of legalMoves(pos)) {
      const canonical = toSan(pos, m);
      if (bareSan(canonical) === want) return { ...m, san: canonical };
    }
    return null;
  }

  // Returns headers, the SAN moves, and each move's clock from a following
  // {[%clk h:mm:ss.s]} comment, in tenths of a second (null when absent).
  function parsePgn(pgn) {
    const headers = {};
    for (const m of pgn.matchAll(/^\[(\w+)\s+"([^"]*)"\]\s*$/gm)) headers[m[1]] = m[2];
    let body = pgn.replace(/^\[.*\]\s*$/gm, ' ').replace(/;[^\n{}]*/g, ' ');
    for (let prev; prev !== body;) { prev = body; body = body.replace(/\([^()]*\)/g, ' '); }
    const sans = [];
    const clocks = [];
    for (const [tok] of body.matchAll(/\{[^}]*\}|[^\s{}]+/g)) {
      if (tok[0] === '{') {
        const clk = tok.match(/%clk\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (clk && sans.length) clocks[sans.length - 1] = Math.round((clk[1] * 3600 + clk[2] * 60 + Number(clk[3])) * 10);
        continue;
      }
      const san = tok.replace(/^\d+\.+/, '').replace(/^\$\d+$/, '');
      if (san && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(san)) {
        sans.push(san);
        clocks.push(null);
      }
    }
    return { headers, sans, clocks };
  }

  function replay({ fen = START_FEN, sans }) {
    const positions = [parseFen(fen)];
    const moves = [];
    for (const san of sans) {
      const pos = positions[positions.length - 1];
      const move = sanToMove(pos, san);
      if (!move) throw new Error(`Illegal or unparseable move "${san}" at ply ${moves.length + 1}`);
      moves.push({ san: move.san, from: move.from, to: move.to });
      positions.push(applyMove(pos, move));
    }
    return { positions, moves };
  }

  // chess.com "TCN" move encoding: two characters per move, each an index into
  // this alphabet. Indexes 0..63 are squares (a1 = 0). A target index above 63
  // is a promotion: the piece is "qnrbkp"[(t - 64) / 3] and (t - 64) % 3 picks
  // the target file relative to the pawn (left, straight, right).
  const TCN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?{~}(^)[_]@#$,./&-*++=';

  function decodeTcn(tcn) {
    const moves = [];
    for (let i = 0; i < tcn.length; i += 2) {
      const from = TCN.indexOf(tcn[i]);
      let to = TCN.indexOf(tcn[i + 1]);
      if (from < 0 || from > 63 || to < 0) throw new Error(`Unsupported TCN move "${tcn.slice(i, i + 2)}"`);
      let promo;
      if (to > 63) {
        promo = 'qnrbkp'[Math.floor((to - 64) / 3)];
        to = from + (from < 16 ? -8 : 8) + ((to - 64) % 3) - 1;
      }
      moves.push(promo ? { from, to, promo } : { from, to });
    }
    return moves;
  }

  // Play decoded moves from `fen`, returning their SAN. Throws on an illegal move.
  function movesToSans(fen, moveList) {
    let pos = parseFen(fen);
    return moveList.map((m, i) => {
      const legal = legalMoves(pos).find((l) => l.from === m.from && l.to === m.to && (l.promo || '') === (m.promo || ''));
      if (!legal) throw new Error(`Illegal move ${squareName(m.from)}-${squareName(m.to)} at ply ${i + 1}`);
      const san = toSan(pos, legal);
      pos = applyMove(pos, legal);
      return san;
    });
  }

  return {
    START_FEN, squareName, squareIndex, colorOf, typeOf,
    parseFen, toFen, attacked, inCheck, legalMoves, applyMove,
    toSan, sanToMove, parsePgn, replay, decodeTcn, movesToSans,
  };
});
