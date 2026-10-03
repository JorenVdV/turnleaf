// epubjs ships no types for its view managers; these cover what ReaderSession extends.
declare module 'epubjs/src/managers/default' {
  export default class DefaultViewManager {
    constructor(options: object);
    isPaginated: boolean;
    settings: { axis?: string; direction?: string };
    views: { length: number };
    container: HTMLElement;
    layout: { delta: number };
    next(): Promise<unknown> | undefined;
    prev(): Promise<unknown> | undefined;
    scrollTo(x: number, y: number, silent?: boolean): void;
  }
}
