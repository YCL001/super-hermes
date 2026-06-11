export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  subscribe(name, handler) {
    if (!this.handlers.has(name)) {
      this.handlers.set(name, new Set());
    }
    this.handlers.get(name).add(handler);

    return () => {
      this.handlers.get(name)?.delete(handler);
    };
  }

  publish(name, payload) {
    const event = {
      id: crypto.randomUUID(),
      name,
      at: new Date().toISOString(),
      payload,
    };

    const handlers = this.handlers.get(name);
    if (handlers) {
      for (const handler of handlers) {
        handler(event);
      }
    }

    return event;
  }
}

export const eventBus = new EventBus();
