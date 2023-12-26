import { getBytes, getLines, getMessages } from './parse';
export const EventStreamContentType = 'text/event-stream';
const DefaultRetryInterval = 1000;
const LastEventId = 'last-event-id';
export function fetchEventSource(input, { signal: inputSignal, headers: inputHeaders, onopen: inputOnOpen, onmessage, onclose, onerror, openWhenHidden, fetch: inputFetch, ...rest }) {
    return new Promise((resolve, reject) => {
        const headers = { ...inputHeaders };
        if (!headers.accept) {
            headers.accept = EventStreamContentType;
        }
        let curRequestController;
        function onVisibilityChange() {
            curRequestController.abort();
            if (!document.hidden) {
                create();
            }
        }
        if (!openWhenHidden) {
            document.addEventListener('visibilitychange', onVisibilityChange);
        }
        let retryInterval = DefaultRetryInterval;
        let retryTimer = 0;
        function dispose() {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.clearTimeout(retryTimer);
            curRequestController.abort();
        }
        inputSignal?.addEventListener('abort', () => {
            dispose();
            resolve();
        });
        const fetch = inputFetch ?? window.fetch;
        const onopen = inputOnOpen ?? defaultOnOpen;
        async function create() {
            curRequestController = new AbortController();
            try {
                const response = await fetch(input, {
                    ...rest,
                    headers,
                    signal: curRequestController.signal,
                });
                await onopen(response);
                await getBytes(response.body, getLines(getMessages(id => {
                    if (id) {
                        headers[LastEventId] = id;
                    }
                    else {
                        delete headers[LastEventId];
                    }
                }, retry => {
                    retryInterval = retry;
                }, onmessage)));
                onclose?.();
                dispose();
                resolve();
            }
            catch (err) {
                if (!curRequestController.signal.aborted) {
                    try {
                        const interval = onerror?.(err) ?? retryInterval;
                        window.clearTimeout(retryTimer);
                        retryTimer = window.setTimeout(create, interval);
                    }
                    catch (innerErr) {
                        dispose();
                        reject(innerErr);
                    }
                }
            }
        }
        create();
    });
}
function defaultOnOpen(response) {
    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith(EventStreamContentType)) {
        throw new Error(`Expected content-type to be ${EventStreamContentType}, Actual: ${contentType}`);
    }
}
//# sourceMappingURL=fetch.js.map