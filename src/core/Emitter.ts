type Handler<T> = (payload: T) => void;

/** Tiny typed event emitter shared by systems and UI. */
export class Emitter<Events extends Record<string, unknown>> {
  private handlers = new Map<keyof Events, Set<Handler<any>>>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    this.handlers.get(type)?.forEach((fn) => fn(payload));
  }
}
