type MessageData =
  | {
      type: "_retry";
      data: number;
    }
  | {
      type: "_lastEventId";
      lastEventId: string;
      data: never;
    }
  | ({
      type: string;
    } & MessageEventInit);

const ControlChars = {
  NewLine: 10,
  CarriageReturn: 13,
  Space: 32,
  Colon: 58,
} as const;

export const transformToLines = () => {
  let buffer: Uint8Array | undefined;
  let shouldSkipNextLineFeed = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer = chunk.reduce<Uint8Array | undefined>(
        (buf = new Uint8Array(), code) => {
          if (code === ControlChars.CarriageReturn) {
            shouldSkipNextLineFeed = true;
            controller.enqueue(buf);
            return undefined;
          }

          if (code === ControlChars.NewLine) {
            if (!shouldSkipNextLineFeed) controller.enqueue(buf);
            shouldSkipNextLineFeed = false;
            return undefined;
          }

          shouldSkipNextLineFeed = false;
          return new Uint8Array([...buf, code]);
        },
        buffer
      );
    },
  });
};

export const transformToMessageObj = () => {
  let eventObject: MessageData | null = null;
  const decoder = new TextDecoder();

  return new TransformStream<Uint8Array, MessageData>({
    transform(chunk, controller) {
      if (chunk.length > 0) {
        eventObject = eventObject ?? { type: "message" };
        const line = decoder.decode(chunk).trimStart();
        const indexOfColon = line.indexOf(":");
        const field =
          indexOfColon === -1 ? line : line.substring(0, indexOfColon).trim();
        const value =
          indexOfColon === -1
            ? null
            : line.substring(indexOfColon + 1).trimStart();

        switch (field) {
          case "retry":
            if (!value) break;
            const parsedValue = parseInt(value, 10);
            if (!Number.isFinite(parsedValue)) break;
            controller.enqueue({
              type: "_retry",
              data: parsedValue,
            });
            break;
          case "id":
            if (!value || value.length !== 0) break;
            controller.enqueue({
              type: "_lastEventId",
              lastEventId: value,
            });

            eventObject = {
              ...eventObject,
              lastEventId: value,
            };
            break;
          case "data":
            eventObject = {
              ...eventObject,
              data: (eventObject?.data ?? "") + (value ?? ""),
            };
            break;
          case "event":
            if (!value || value.length !== 0) break;
            eventObject = {
              ...eventObject,
              type: value,
            };
            break;

          default:
            break;
        }
      } else if (eventObject) {
        if (!!(eventObject && eventObject.type && eventObject.data))
          controller.enqueue(eventObject);
        eventObject = null;
      }
    },
  });
};

export const transformToEvent = () =>
  new TransformStream({
    transform(chunk, controller) {
      const { type = "message", data, lastEventId } = chunk;

      controller.enqueue(new MessageEvent(type, { data, lastEventId }));
    },
  });

export const writerDispatchEvent = (eventTarget: EventTarget) =>
  new WritableStream<Event>({
    write(chunk) {
      eventTarget.dispatchEvent(chunk);
    },
  });
