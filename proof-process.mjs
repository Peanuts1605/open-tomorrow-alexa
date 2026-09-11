// A real separate Node process, used only by the reproducibility demo.
import { startServer } from './server.mjs';
const server = await startServer({ file: process.argv[2] });
process.send({ url: server.url, pid: process.pid });
process.on('message', async message => {
  if (message === 'stop') { await server.close(); process.exit(0); }
});
process.on('disconnect', async () => { await server.close(); process.exit(0); });
