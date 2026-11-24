/**
 * The sign-in gate of a hosted install. Every password check on the server
 * — signing in, changing your own password, the current password typed to
 * change an e-mail — goes through it, in three layers:
 *
 *  1. The client (clientKey in auth.ts: an IPv4 address, or a whole IPv6
 *     /64). One synchronous step, before anything is awaited, checks its
 *     limits and reserves the attempt: CLIENT_IN_FLIGHT at a time,
 *     CLIENT_ATTEMPTS a minute whether they succeed or not, and LOGIN_LIMIT
 *     failures a minute — an attempt still in progress counts as a failure
 *     until it ends, so the limit holds for attempts sent together too.
 *  2. The e-mail. Attempts for one e-mail run strictly one after another:
 *     EMAIL_WAITING may wait their turn; past that the answer is "wait",
 *     without a password check. Past EMAIL_SLOW_AFTER failures, each turn
 *     begins with a delay that doubles up to EMAIL_DELAY_CAP_MS. An e-mail
 *     nobody has goes through exactly the same line, so nothing in the
 *     timing or the answer says whether it has an account. A browser that
 *     has signed in to that account before (its known-browser cookie)
 *     skips the line and the delay, but still never has its password
 *     checked beside another attempt for the same e-mail.
 *  3. The password checks themselves: HASH_SLOTS at a time, at most
 *     CLIENT_SLOTS of them for one client; whoever waits is served
 *     round-robin across clients, known browsers first and in a room of
 *     their own; "wait" only once a room is full.
 *
 * The clock is injected, so tests run a day of attempts without waiting.
 */
import { EMAIL_LOGIN_LIMIT, EMAIL_LOGIN_WINDOW_MS, LOGIN_LIMIT, LoginLimiter } from "./auth";

/** Sign-ins from one client being checked at once. */
export const CLIENT_IN_FLIGHT = 2;
/** Sign-ins (and other password checks) from one client a minute, successful or not. */
export const CLIENT_ATTEMPTS = 20;
export const CLIENT_ATTEMPTS_WINDOW_MS = 60_000;

/** Attempts for one e-mail that may wait for their turn behind the one being checked; beyond that, "wait". */
export const EMAIL_WAITING = 3;
/**
 * The delay for one e-mail. Failures counted for an e-mail, from any number
 * of clients, are forgotten only after EMAIL_QUIET_MS without one. Past
 * EMAIL_SLOW_AFTER of them, each attempt's turn begins with a delay of
 * EMAIL_DELAY_BASE_MS · 2^(failures − EMAIL_SLOW_AFTER), at most
 * EMAIL_DELAY_CAP_MS.
 *
 * The most guesses one e-mail can receive in a day, from any number of
 * addresses and without a browser that has signed in to it before: attempts
 * run one at a time, so the first 10 run at the speed of a password check,
 * the next 5 wait 1 + 2 + 4 + 8 + 16 = 31 s between them, and every one
 * after that waits 30 s: 10 + 5 + (86,400 − 31) / 30 ≈ 2,894 a day. Pausing
 * to let the count be forgotten only lowers that: a pause of 15 minutes buys
 * 15 quick guesses, where waiting would have bought 30.
 */
export const EMAIL_SLOW_AFTER = 10;
export const EMAIL_DELAY_BASE_MS = 1_000;
export const EMAIL_DELAY_CAP_MS = 30_000;
export const EMAIL_QUIET_MS = 15 * 60_000;
/** The bound worked out above, rounded up: what a test holds the gate to. */
export const EMAIL_GUESSES_PER_DAY = 2_900;

/** Wrong passwords from one known browser, within EMAIL_QUIET_MS, before it is treated as unknown. */
export const KNOWN_BROWSER_FAILURES = 3;
/** Known browsers' attempts for one e-mail waiting for the one being checked. */
export const KNOWN_WAITING_PER_EMAIL = 4;

/** Password checks running at once (scrypt, about 32 MB each), and how many of them one client may hold. */
export const HASH_SLOTS = 2;
export const CLIENT_SLOTS = 1;
/** Checks waiting for a slot past which the answer is "wait": known browsers have a room of their own. */
export const KNOWN_ROOM = 64;
export const STANDARD_ROOM = 256;

/** Clients and e-mails remembered at most; the oldest idle ones are let go first. */
export const TRACKED_MAX = 20_000;

export interface SignInClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: SignInClock = {
  now: () => Date.now(),
  sleep: (ms) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);

      timer.unref?.();
    }),
};

/**
 * Why an attempt was refused before its password was checked.
 *  client — its client is past one of its limits;
 *  pair   — too many failures for this e-mail from this client;
 *  email  — too many attempts for this e-mail are waiting already;
 *  busy   — the waiting room for password checks is full.
 */
export type Refusal = "client" | "pair" | "email" | "busy";
export type Outcome<T> = { refused: Refusal } | { refused: null; value: T };

/** One reserved attempt from one client. Released once, when the request is done with it. */
export interface Ticket {
  readonly client: string;
  release(): void;
}

interface ClientState {
  inFlight: number;
  attempts: number;
  since: number;
}

interface Line {
  /** An unknown browser's attempt has its turn (waiting out its delay, or being checked). */
  turn: boolean;
  waiting: Array<() => void>;
  /** A password is being checked for this e-mail. */
  hashing: boolean;
  knownWaiting: Array<() => void>;
  /** The attempt whose turn it is, waiting for a known browser's check to end. */
  turnWaiting: (() => void) | null;
  failures: number;
  lastFailure: number;
  touched: number;
}

/** Counts in progress, per key: added to the failures already counted, so a limit holds for attempts sent together. */
class Pending {
  private readonly counts = new Map<string, number>();

  of(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  begin(key: string): () => void {
    this.counts.set(key, this.of(key) + 1);
    let ended = false;

    return () => {
      if (ended) return;
      ended = true;
      const left = this.of(key) - 1;

      if (left > 0) this.counts.set(key, left);
      else this.counts.delete(key);
    };
  }
}

type Kind = "known" | "standard";

/** Password checks a few at a time; waiting ones served round-robin across clients, known browsers first. */
export class FairPool {
  private running = 0;
  private readonly runningBy = new Map<string, number>();
  private readonly waiting: Record<Kind, Map<string, Array<() => void>>> = { known: new Map(), standard: new Map() };
  private readonly waitingCount: Record<Kind, number> = { known: 0, standard: 0 };

  constructor(
    private readonly slots = HASH_SLOTS,
    private readonly perClient = CLIENT_SLOTS,
    private readonly rooms: Record<Kind, number> = { known: KNOWN_ROOM, standard: STANDARD_ROOM }
  ) {}

  /** Runs `task` in its turn; null, without running it, when its kind's waiting room is full. */
  async run<T>(client: string, kind: Kind, task: () => Promise<T>): Promise<{ value: T } | null> {
    if (this.mayStart(client)) this.start(client);
    else {
      if (this.waitingCount[kind] >= this.rooms[kind]) return null;
      await new Promise<void>((resolve) => {
        const line = this.waiting[kind].get(client) ?? [];

        line.push(resolve);
        this.waiting[kind].set(client, line);
        this.waitingCount[kind] += 1;
      });
    }
    try {
      return { value: await task() };
    } finally {
      this.finish(client);
      this.dispatch();
    }
  }

  /** Checks running now, for tests and the log. */
  get active(): number {
    return this.running;
  }

  private mayStart(client: string): boolean {
    return this.running < this.slots && (this.runningBy.get(client) ?? 0) < this.perClient;
  }

  private start(client: string): void {
    this.running += 1;
    this.runningBy.set(client, (this.runningBy.get(client) ?? 0) + 1);
  }

  private finish(client: string): void {
    this.running -= 1;
    const left = (this.runningBy.get(client) ?? 1) - 1;

    if (left > 0) this.runningBy.set(client, left);
    else this.runningBy.delete(client);
  }

  private dispatch(): void {
    while (this.running < this.slots) {
      const next = this.next("known") ?? this.next("standard");

      if (!next) return;
      next();
    }
  }

  /** The first client of `kind`, in turn order, that may start; moved to the back of the turn order. */
  private next(kind: Kind): (() => void) | null {
    const lines = this.waiting[kind];

    for (const [client, line] of lines) {
      if (!this.mayStart(client)) continue;
      const resolve = line.shift()!;

      lines.delete(client);
      if (line.length > 0) lines.set(client, line);
      this.waitingCount[kind] -= 1;
      this.start(client);
      return resolve;
    }
    return null;
  }
}

export class SignInGate {
  private readonly clients = new Map<string, ClientState>();
  private readonly lines = new Map<string, Line>();
  /** Failures per e-mail and client together. */
  private readonly pairs = new LoginLimiter(EMAIL_LOGIN_LIMIT, EMAIL_LOGIN_WINDOW_MS);
  private readonly pairPending = new Pending();
  /** Wrong passwords per known browser. */
  private readonly known = new LoginLimiter(KNOWN_BROWSER_FAILURES, EMAIL_QUIET_MS);
  private readonly knownPending = new Pending();
  readonly pool = new FairPool();

  constructor(
    private readonly clock: SignInClock = realClock,
    /** Failed attempts per client: shared with the server's other checks of a code or a password (app.ts). */
    private readonly failures: LoginLimiter = new LoginLimiter()
  ) {}

  /**
   * Checks the client's limits and reserves one attempt, in one synchronous
   * step: call it before anything is awaited. Null: refused.
   */
  reserve(client: string): Ticket | null {
    const now = this.clock.now();
    let state = this.clients.get(client);

    if (state && now - state.since >= CLIENT_ATTEMPTS_WINDOW_MS) {
      state.attempts = 0;
      state.since = now;
    }
    const inFlight = state?.inFlight ?? 0;

    if (inFlight >= CLIENT_IN_FLIGHT || (state?.attempts ?? 0) >= CLIENT_ATTEMPTS) return null;
    if (this.failures.count(client, now) + inFlight >= LOGIN_LIMIT) return null;
    if (!state) {
      state = { inFlight: 0, attempts: 0, since: now };
      this.clients.set(client, state);
      if (this.clients.size > TRACKED_MAX) this.pruneClients(now);
    }
    const held = state;
    let released = false;

    held.inFlight += 1;
    held.attempts += 1;
    return {
      client,
      release: () => {
        if (released) return;
        released = true;
        held.inFlight -= 1;
      },
    };
  }

  /**
   * One sign-in: `check` is the password check, run in this e-mail's turn
   * and the pool's; `failed` says whether it was a wrong one. `knownBrowser`
   * is the known-browser cookie's id when it is valid for the account this
   * e-mail belongs to (accounts-routes.ts decides that), else null.
   */
  async signIn<T>(ticket: Ticket, email: string, knownBrowser: string | null, check: () => Promise<T>, failed: (value: T) => boolean): Promise<Outcome<T>> {
    const now = this.clock.now();
    const pair = `${email}\n${ticket.client}`;

    if (this.pairs.count(pair, now) + this.pairPending.of(pair) >= EMAIL_LOGIN_LIMIT) return { refused: "pair" };
    const line = this.lineFor(email, now);
    const known = knownBrowser !== null && this.known.count(knownBrowser, now) + this.knownPending.of(knownBrowser) < KNOWN_BROWSER_FAILURES;

    if (known ? line.knownWaiting.length >= KNOWN_WAITING_PER_EMAIL : line.turn && line.waiting.length >= EMAIL_WAITING) return { refused: "email" };
    const endPair = this.pairPending.begin(pair);
    const endKnown = known ? this.knownPending.begin(knownBrowser) : () => undefined;
    let hashing = false;
    let turn = false;

    try {
      if (!known) {
        // Everything up to here was synchronous: the place in the line is taken in the same step as the checks above.
        if (line.turn) await new Promise<void>((resolve) => line.waiting.push(resolve));
        else line.turn = true;
        turn = true;
        const delay = this.delayFor(line, this.clock.now());

        if (delay > 0) await this.clock.sleep(delay);
      }
      await this.takeHash(line, known);
      hashing = true;
      const ran = await this.pool.run(ticket.client, known ? "known" : "standard", check);

      if (ran === null) return { refused: "busy" };
      const { value } = ran;

      if (failed(value)) {
        const at = this.clock.now();

        line.failures = at - line.lastFailure >= EMAIL_QUIET_MS ? 1 : line.failures + 1;
        line.lastFailure = at;
        this.pairs.fail(pair, at);
        this.failures.fail(ticket.client, at);
        if (knownBrowser !== null) this.known.fail(knownBrowser, at);
      }
      return { refused: null, value };
    } finally {
      if (hashing) this.releaseHash(line);
      if (turn) this.releaseTurn(line);
      endPair();
      endKnown();
      line.touched = this.clock.now();
      this.forgetIfIdle(email, line);
    }
  }

  /** A password check that isn't a sign-in (your own current password): the client's limits and the pool's turn. */
  async checkPassword<T>(ticket: Ticket, check: () => Promise<T>, failed: (value: T) => boolean): Promise<Outcome<T>> {
    const ran = await this.pool.run(ticket.client, "standard", check);

    if (ran === null) return { refused: "busy" };
    if (failed(ran.value)) this.failures.fail(ticket.client, this.clock.now());
    return { refused: null, value: ran.value };
  }

  /** The delay this e-mail's next turn begins with. */
  delayFor(line: Pick<Line, "failures" | "lastFailure">, now: number): number {
    if (now - line.lastFailure >= EMAIL_QUIET_MS) return 0;
    const over = line.failures - EMAIL_SLOW_AFTER;

    return over < 0 ? 0 : Math.min(EMAIL_DELAY_CAP_MS, EMAIL_DELAY_BASE_MS * 2 ** over);
  }

  /** E-mails and clients remembered now (tests: the state stays bounded). */
  get tracked(): { emails: number; clients: number } {
    return { emails: this.lines.size, clients: this.clients.size };
  }

  private lineFor(email: string, now: number): Line {
    let line = this.lines.get(email);

    if (!line) {
      line = { turn: false, waiting: [], hashing: false, knownWaiting: [], turnWaiting: null, failures: 0, lastFailure: 0, touched: now };
      this.lines.set(email, line);
      if (this.lines.size > TRACKED_MAX) this.pruneLines(now);
    }
    line.touched = now;
    return line;
  }

  private takeHash(line: Line, known: boolean): Promise<void> | void {
    if (!line.hashing) {
      line.hashing = true;
      return;
    }
    return new Promise<void>((resolve) => {
      if (known) line.knownWaiting.push(resolve);
      else line.turnWaiting = resolve;
    });
  }

  /** The check slot for this e-mail passes straight to the next one: known browsers first. */
  private releaseHash(line: Line): void {
    const next = line.knownWaiting.shift() ?? line.turnWaiting;

    if (next === line.turnWaiting) line.turnWaiting = null;
    if (next) next();
    else line.hashing = false;
  }

  private releaseTurn(line: Line): void {
    const next = line.waiting.shift();

    if (next) next();
    else line.turn = false;
  }

  private idle(line: Line): boolean {
    return !line.turn && !line.hashing && line.waiting.length === 0 && line.knownWaiting.length === 0 && line.turnWaiting === null;
  }

  private forgetIfIdle(email: string, line: Line): void {
    if (this.idle(line) && (line.failures === 0 || this.clock.now() - line.lastFailure >= EMAIL_QUIET_MS)) this.lines.delete(email);
  }

  /**
   * Over TRACKED_MAX: first what has run out, then — oldest first — idle
   * e-mails that aren't being slowed, and only then idle ones that are, so
   * filling the table with other e-mails is the slowest way to make an
   * e-mail's count be forgotten.
   */
  private pruneLines(now: number): void {
    const target = Math.floor(TRACKED_MAX * 0.9);
    const passes: Array<(line: Line) => boolean> = [
      (line) => line.failures === 0 || now - line.lastFailure >= EMAIL_QUIET_MS,
      (line) => line.failures < EMAIL_SLOW_AFTER,
      () => true,
    ];

    for (const pass of passes) {
      const candidates = [...this.lines].filter(([, line]) => this.idle(line) && pass(line)).sort((a, b) => a[1].touched - b[1].touched);

      for (const [email] of candidates) {
        if (this.lines.size <= target) return;
        this.lines.delete(email);
      }
    }
  }

  private pruneClients(now: number): void {
    const target = Math.floor(TRACKED_MAX * 0.9);

    for (const [client, state] of this.clients) if (state.inFlight === 0 && now - state.since >= CLIENT_ATTEMPTS_WINDOW_MS) this.clients.delete(client);
    for (const [client, state] of this.clients) {
      if (this.clients.size <= target) return;
      if (state.inFlight === 0) this.clients.delete(client);
    }
  }
}
