import Koa from "koa";
import { PassThrough } from "stream";
import EventEmitter from "events";
import serve from "koa-static";

const events = new EventEmitter();
events.setMaxListeners(0);

new Koa()
  .use(async (ctx, next) => {
    if (ctx.path !== "/sse") {
      return await next();
    }

    ctx.request.socket.setTimeout(0);
    ctx.req.socket.setNoDelay(true);
    ctx.req.socket.setKeepAlive(true);

    ctx.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const stream = new PassThrough();
    ctx.status = 200;
    ctx.body = stream;

    const listener = (data: string, type = "data") => {
      const msg = type + ":" + data + "\r\n\n";
      console.log(`MSG:\n'\n${msg}'`);
      stream.write(type + ":" + data + "\r\n\n");
    };

    events.on("data", listener);

    const interval = setInterval(
      () => events.emit("data", "keepalive", ""),
      10000
    );

    stream.on("close", () => {
      clearInterval(interval);
      events.off("data", listener);
    });
  })
  .use(async (ctx, next) => {
    if (ctx.path !== "/postback") {
      return await next();
    }
    ctx.body = JSON.stringify(ctx.query);
    events.emit("data", JSON.stringify(ctx.query), "data");
  })
  .use(serve("./"))
  .listen(8080, () => console.log("Listening"));
