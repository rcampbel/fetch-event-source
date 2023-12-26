import {
  transformToLines,
  transformToMessageObj,
  transformToEvent,
  writerDispatchEvent,
} from "./transforms";

interface CustomEventSourceOptions {
  abortController?: AbortController;
  maxRetryAttempts?: number;
  initalRetryTime?: number;
  fetchOptions?: RequestInit | (() => RequestInit);
}

class CustomEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  static fetch: (
    input: URL | RequestInfo,
    init?: RequestInit | undefined
  ) => Promise<Response>;

  #getFetchOptions: () => RequestInit;
  #onError?: (e: Event) => void;
  get onerror(): undefined | ((e: Event) => void) {
    return this.#onError;
  }
  set onerror(value: undefined | ((e: Event) => void)) {
    if (typeof this.#onError === "function") {
      this.removeEventListener("error", this.#onError as EventListener);
    }

    this.#onError =
      value !== null && value !== undefined && typeof value !== "function"
        ? undefined
        : value ?? undefined;

    if (typeof this.#onError !== "function") return;
    this.addEventListener("error", this.#onError as EventListener);
  }

  #onMessage?: (e: MessageEvent) => void;
  get onmessage(): undefined | ((e: MessageEvent) => void) {
    return this.#onMessage;
  }
  set onmessage(value: undefined | ((e: MessageEvent) => void)) {
    if (typeof this.#onMessage === "function") {
      this.removeEventListener("message", this.#onMessage as EventListener);
    }

    this.#onMessage =
      value !== null && value !== undefined && typeof value !== "function"
        ? undefined
        : value ?? undefined;

    if (typeof this.#onMessage !== "function") return;
    this.addEventListener("message", this.#onMessage as EventListener);
  }

  #onOpen?: (e: Event) => void;
  get onopen(): undefined | ((e: Event) => void) {
    return this.#onOpen;
  }
  set onopen(value: undefined | ((e: Event) => void)) {
    if (typeof this.#onOpen === "function") {
      this.removeEventListener("open", this.#onOpen as EventListener);
    }

    this.#onOpen =
      value !== null && value !== undefined && typeof value !== "function"
        ? undefined
        : value ?? undefined;

    if (typeof this.#onOpen !== "function") return;
    this.addEventListener("open", this.#onOpen as EventListener);
  }

  #readyState = CustomEventSource.CONNECTING;

  #_timeoutId?: ReturnType<typeof setTimeout>;
  get #timeoutId(): ReturnType<typeof setTimeout> | undefined {
    return this.#_timeoutId;
  }
  set #timeoutId(value: ReturnType<typeof setTimeout> | undefined) {
    if (this.#_timeoutId) clearTimeout(this.#_timeoutId);
    this.#_timeoutId = value;
  }

  #_requestController?: AbortController;
  get #requestController() {
    return this.#_requestController;
  }
  set #requestController(value: AbortController | undefined) {
    this.#_requestController = value;
    this.#_requestController?.signal.addEventListener(
      "abort",
      () => (this.#timeoutId = undefined)
    );
    this.#_requestController?.signal.addEventListener(
      "abort",
      () => (this.#requestController = undefined)
    );
  }

  #_lastEventId?: string;
  get #lastEventId(): string | undefined {
    return this.#_lastEventId;
  }
  set #lastEventId(value: unknown) {
    let _value = typeof value === "string" ? value.trim() : value;
    _value =
      typeof _value === "number" && Number.isFinite(_value)
        ? _value.toString()
        : _value;
    this.#_lastEventId = typeof _value === "string" ? _value : undefined;
  }

  constructor(
    url: string | URL | globalThis.Request,
    moduleOptions: CustomEventSourceOptions = {}
  ) {
    super();

    const initalAtemptCount = Number.isFinite(moduleOptions.maxRetryAttempts)
      ? moduleOptions.maxRetryAttempts ?? Infinity
      : Infinity;

    let retryAtemptCount = initalAtemptCount;

    let retryTimeInMS = Number.isFinite(moduleOptions.initalRetryTime)
      ? moduleOptions.initalRetryTime
      : 0;

    this.#requestController =
      moduleOptions.abortController ?? new AbortController();

    this.#getFetchOptions =
      typeof moduleOptions.fetchOptions === "function"
        ? moduleOptions.fetchOptions
        : () => (moduleOptions.fetchOptions as RequestInit) ?? {};

    Object.defineProperties(this, {
      url: {
        enumerable: true,
        get: () => url.toString(),
      },
      onerror: {
        enumerable: true,
        get: () => this.#onError,
        set: (value) => {
          if (typeof this.#onError === "function") {
            this.removeEventListener("error", this.#onError);
          }

          this.#onError =
            value !== null && value !== undefined && typeof value !== "function"
              ? null
              : value;

          if (typeof this.#onError !== "function") return;
          this.addEventListener("error", this.#onError);
        },
      },
      onopen: {
        enumerable: true,
        get: () => this.#onOpen,
        set: (value) => {
          if (typeof this.#onOpen === "function") {
            this.removeEventListener("open", this.#onOpen);
          }

          this.#onOpen =
            value !== null && value !== undefined && typeof value !== "function"
              ? null
              : value;

          if (typeof this.#onOpen !== "function") return;
          this.addEventListener("open", this.#onOpen);
        },
      },
    });

    // open actions
    this.addEventListener(
      "open",
      () => (this.#readyState = CustomEventSource.OPEN)
    );
    this.addEventListener("open", () => (retryAtemptCount = initalAtemptCount));
    this.addEventListener("open", () => (this.#timeoutId = undefined));

    // close actions
    this.addEventListener(
      "_close",
      () => (this.#readyState = CustomEventSource.CLOSED)
    );
    this.addEventListener("_close", () => this.#requestController?.abort());
    this.addEventListener("_close", () => (this.#timeoutId = undefined));

    // error action
    this.addEventListener("error", () => {
      if (retryAtemptCount < 0) {
        this.#timeoutId = undefined;
        return;
      }

      retryAtemptCount = retryAtemptCount - 1;
      let retryTime = retryTimeInMS ?? 0;

      this.#timeoutId =
        retryTime >= 0
          ? (this.#timeoutId = setTimeout(() => this.open(), retryTime))
          : undefined;
    });

    // other internal actions
    this.addEventListener(
      "_retry",
      (e) => (retryTimeInMS = (e as MessageEvent).data ?? retryTimeInMS)
    );

    this.addEventListener(
      "_lastEventId",
      (e) => (this.#lastEventId = (e as MessageEvent).data.lastEventId)
    );
  }

  /**
   *
   */
  open() {
    if (!CustomEventSource.fetch) {
      throw new SyntaxError(
        "CustomEventSource is missing a method called `fetch`"
      );
    }

    this.#requestController = new AbortController();
    this.#readyState = CustomEventSource.CONNECTING;

    let fetchOptions: RequestInit = this.#getFetchOptions() ?? {};

    fetchOptions = { ...fetchOptions };
    if (this.#lastEventId) {
      fetchOptions.headers = fetchOptions.headers ?? {};
      fetchOptions.headers = {
        ...fetchOptions.headers,
        LastEventId: this.#lastEventId,
      };
    }

    const abortSignal = this.#requestController.signal;
    fetchOptions.signal = abortSignal;

    const fetchCall = CustomEventSource.fetch("http://localhost:8080/sse");

    fetchCall.then(() => this.dispatchEvent(new Event("open")));

    fetchCall
      .then(async (response) => {
        if (response.body) {
          response.body
            .pipeThrough(transformToLines(), { signal: abortSignal })
            .pipeThrough(transformToMessageObj(), { signal: abortSignal })
            .pipeThrough(transformToEvent(), { signal: abortSignal })
            .pipeTo(writerDispatchEvent(this), { signal: abortSignal });
        } else {
          this.dispatchEvent(new Event("error"));
        }
      })
      .catch(() => this.dispatchEvent(new Event("error")));
  }

  /**
   *
   */
  close() {
    this.dispatchEvent(new Event("_close"));
  }

  get readyState() {
    return this.#readyState;
  }
}

CustomEventSource.fetch = fetch.bind(window);
const x = new CustomEventSource("http://localhost:8080/sse");
x.open();
