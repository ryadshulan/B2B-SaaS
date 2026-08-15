export class WorkerApplication {
  private running = false;
  start(): void { this.running = true; }
  stop(): void { this.running = false; }
  isRunning(): boolean { return this.running; }
}
