export interface PiSessionDialogTicket {
  scope: number;
  request: number;
}

/** Keeps asynchronous dialog results inside the session that started them. */
export class PiSessionDialogGuard {
  private key = "";
  private scope = 0;
  private request = 0;

  syncContext(key: string): number {
    if (this.key !== key) {
      this.key = key;
      this.scope++;
      this.request++;
    }
    return this.scope;
  }

  begin(key: string): PiSessionDialogTicket {
    this.syncContext(key);
    return { scope: this.scope, request: ++this.request };
  }

  invalidate(): void { this.request++; }

  isCurrent(ticket: PiSessionDialogTicket): boolean {
    return ticket.scope === this.scope && ticket.request === this.request;
  }
}
