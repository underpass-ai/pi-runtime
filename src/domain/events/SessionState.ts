type Props = {
  everOpened: boolean; open: boolean; phase: string | null; model: string | null; turns: number;
  tokensIn: number; tokensOut: number; tokensCached: number; cost: number; calls: Record<string, Record<string, number>>; selections: number;
};

export class SessionState {
  readonly everOpened: boolean; readonly open: boolean; readonly phase: string | null; readonly model: string | null; readonly turns: number;
  readonly tokensIn: number; readonly tokensOut: number; readonly tokensCached: number; readonly cost: number;
  readonly calls: Readonly<Record<string, Readonly<Record<string, number>>>>; readonly selections: number;
  private constructor(p: Props) {
    this.everOpened = p.everOpened; this.open = p.open; this.phase = p.phase; this.model = p.model; this.turns = p.turns;
    this.tokensIn = p.tokensIn; this.tokensOut = p.tokensOut; this.tokensCached = p.tokensCached; this.cost = p.cost; this.calls = p.calls; this.selections = p.selections;
  }
  static readonly EMPTY = new SessionState({ everOpened: false, open: false, phase: null, model: null, turns: 0, tokensIn: 0, tokensOut: 0, tokensCached: 0, cost: 0, calls: {}, selections: 0 });
  with(changes: Partial<Props>): SessionState {
    return new SessionState({ everOpened: this.everOpened, open: this.open, phase: this.phase, model: this.model, turns: this.turns, tokensIn: this.tokensIn,
      tokensOut: this.tokensOut, tokensCached: this.tokensCached, cost: this.cost, calls: this.calls as Record<string, Record<string, number>>, selections: this.selections, ...changes });
  }
}
