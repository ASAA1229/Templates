import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? {{port}});
createApp().listen(port, "127.0.0.1", () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
