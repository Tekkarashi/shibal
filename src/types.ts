export type Status = 'open' | 'applied' | 'skipped';
export type Source = 'manual' | 'share' | 'whatsapp';

export interface Item {
  id: string;
  title: string;
  url: string | null;
  notes: string;
  /** ISO string, or null when the item still needs a deadline. */
  deadline: string | null;
  status: Status;
  source: Source;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  /** Use alarm-clock delivery for last-day reminders so phone makers cannot delay them. */
  strict: boolean;
  /** Morning summary of what is due soon. */
  digest: boolean;
}

export const DEFAULT_SETTINGS: Settings = { strict: true, digest: true };

/** What the add/edit form starts from, usually built from a shared message. */
export interface Draft {
  title: string;
  url: string | null;
  notes: string;
  deadline: string | null;
  source: Source;
  /** The piece of text the deadline was guessed from, shown so the user can check it. */
  guessedFrom?: string;
}
