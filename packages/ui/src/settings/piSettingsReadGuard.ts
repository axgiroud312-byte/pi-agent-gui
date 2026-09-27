export type PiSettingsEditorScope = "user" | "project";

export interface PiSettingsReadTicket {
  sequence: number;
  editVersion: number;
  workspacePath: string;
  scope: PiSettingsEditorScope;
}

/** Invalidates stale Host reads when the editor context or local draft changes. */
export class PiSettingsReadGuard {
  private sequence = 0;
  private editVersion = 0;
  private workspacePath = "";
  private scope: PiSettingsEditorScope = "user";

  syncContext(workspacePath: string, scope: PiSettingsEditorScope): void {
    if (this.workspacePath === workspacePath && this.scope === scope) return;
    this.workspacePath = workspacePath;
    this.scope = scope;
    this.sequence++;
  }

  begin(workspacePath: string, scope: PiSettingsEditorScope): PiSettingsReadTicket {
    this.syncContext(workspacePath, scope);
    this.sequence++;
    return { sequence: this.sequence, editVersion: this.editVersion, workspacePath, scope };
  }

  markEdited(): void { this.editVersion++; }

  isLatestRead(ticket: PiSettingsReadTicket): boolean {
    return ticket.sequence === this.sequence && ticket.workspacePath === this.workspacePath && ticket.scope === this.scope;
  }

  isCurrent(ticket: PiSettingsReadTicket): boolean {
    return this.isLatestRead(ticket) && ticket.editVersion === this.editVersion;
  }
}
