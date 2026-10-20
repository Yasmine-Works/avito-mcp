/** Only explicitly authored, non-sensitive messages may reach MCP error output. */
export class AppError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AppError";
  }
}
