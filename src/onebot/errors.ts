export class OneBotConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OneBotConnectionError';
  }
}

export class OneBotTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OneBotTimeoutError';
  }
}

export class OneBotApiError extends Error {
  readonly retcode: number;

  constructor(message: string, retcode: number) {
    super(message);
    this.name = 'OneBotApiError';
    this.retcode = retcode;
  }
}

export class OneBotProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OneBotProtocolError';
  }
}
